import { useEffect, useMemo, useState } from "react";
import { BigNumber, ethers } from "ethers";

import type { BundlerInstance, Deployments, HexString, Quote, QuoteRequest, SwapStep, UserOpV07 } from "../utils/types";
import { fetchBundlers, fetchDeployments, fetchQuote, postTelemetryEvent } from "../utils/api";
import {
  buildExecuteBatchCallData,
  buildFactoryData,
  buildPackedUserOpV07,
  hexBn,
  makeNonRevertingDummySignature,
  packUint128Pair,
  signEIP7702Authorization,
} from "../utils/userop";
import { formatCountdown, formatUnitsSafe, parseUnitsSafe, shortAddr } from "../utils/format";
import { getOrCreateSessionId } from "../utils/session";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const DEFAULT_SLIPPAGE_BPS = 50;

const ENTRYPOINT_ABI = [
  "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash,address indexed sender,uint256 nonce,bytes revertReason)",
  "error FailedOp(uint256 opIndex,string reason)",
  "error FailedOpWithRevert(uint256 opIndex,string reason,bytes inner)",
];

const PAYMASTER_ERRORS_ABI = [
  "error InvalidUserOpCallData()",
  "error UnsupportedRouter()",
  "error UnsupportedTokenPair()",
  "error FeeTooLow(uint256 requiredFee,uint256 providedFee)",
  "error MinOutTooLowForFee(uint256 minOut,uint256 feeAmount)",
  "error SlippageRisk(uint256 expectedOut,uint256 minOut)",
  "error DepositBelowMinimum(uint256 depositWei,uint256 minDepositWei)",
];

const entryPointIface = new ethers.utils.Interface(ENTRYPOINT_ABI);
const paymasterErrorsIface = new ethers.utils.Interface(PAYMASTER_ERRORS_ABI);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractRevertData(err: any): string | undefined {
  const candidates = [
    err?.data,
    err?.error?.data,
    err?.error?.data?.data,
    err?.error?.data?.originalError?.data,
    err?.rpc?.data,
    err?.rpc?.data?.data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("0x") && c.length > 2) return c;
  }
  return undefined;
}

function decodeRevertData(data: string): string {
  if (typeof data !== "string" || !data.startsWith("0x")) return String(data);

  // Error(string)
  if (data.slice(0, 10) === "0x08c379a0") {
    try {
      const [reason] = ethers.utils.defaultAbiCoder.decode(["string"], "0x" + data.slice(10));
      return `Error(${reason})`;
    } catch {
      return "Error(<decode failed>)";
    }
  }

  // Panic(uint256)
  if (data.slice(0, 10) === "0x4e487b71") {
    try {
      const [code] = ethers.utils.defaultAbiCoder.decode(["uint256"], "0x" + data.slice(10));
      return `Panic(${BigNumber.from(code).toString()})`;
    } catch {
      return "Panic(<decode failed>)";
    }
  }

  return data;
}

function format4337ErrorData(data: string): string {
  // Try EntryPoint custom errors first.
  try {
    const parsed = entryPointIface.parseError(data);
    if (parsed?.name === "FailedOp") {
      const opIndex = BigNumber.from(parsed.args.opIndex).toNumber();
      const reason = String(parsed.args.reason ?? "");
      return `EntryPoint.FailedOp(opIndex=${opIndex}, reason=${reason})`;
    }
    if (parsed?.name === "FailedOpWithRevert") {
      const opIndex = BigNumber.from(parsed.args.opIndex).toNumber();
      const reason = String(parsed.args.reason ?? "");
      const inner = String(parsed.args.inner ?? "");

      // Best-effort: parse paymaster custom errors for nicer UI messaging.
      try {
        const pm = paymasterErrorsIface.parseError(inner);
        return `EntryPoint.FailedOpWithRevert(opIndex=${opIndex}, reason=${reason}, inner=${pm.name})`;
      } catch {
        return `EntryPoint.FailedOpWithRevert(opIndex=${opIndex}, reason=${reason}, inner=${decodeRevertData(inner)})`;
      }
    }

    return `EntryPoint.${parsed.name}`;
  } catch {
    // fall through
  }

  // Then common revert formats.
  return decodeRevertData(data);
}

function formatBundlerRpcError(err: any): string {
  const msg = typeof err?.message === "string" ? err.message : String(err);
  const data = extractRevertData(err?.data ?? err);
  if (!data) return msg;
  return `${msg} — ${format4337ErrorData(data)}`;
}

async function jsonRpcCall<T>(rpcUrl: string, method: string, params: any[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (json?.error) {
    const e = new Error(json.error?.message ?? "RPC error") as any;
    e.rpc = json.error;
    throw e;
  }
  return json.result as T;
}

function AddressDisplay({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span
      className="mono"
      style={{ cursor: "pointer", position: "relative" }}
      onClick={copy}
      title={address} // Native tooltip as fallback
    >
      <span style={{ borderBottom: "1px dashed rgba(255,255,255,0.3)" }}>
        {label ? `${label}: ` : ""}{shortAddr(address)}
      </span>
      {copied && (
        <span style={{
          position: "absolute",
          top: "-24px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#2bd576",
          color: "#000",
          padding: "2px 6px",
          borderRadius: "4px",
          fontSize: "10px",
          fontWeight: "bold",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          zIndex: 10,
        }}>
          Copied!
        </span>
      )}
    </span>
  );
}

export function App() {
  const quoteServiceUrl = import.meta.env.VITE_QUOTE_SERVICE_URL as string | undefined;
  const monitorUrl = import.meta.env.VITE_MONITOR_URL as string | undefined;
  const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined;
  const devPrivateKey = import.meta.env.VITE_DEV_PRIVATE_KEY as string | undefined;

  const readProvider = useMemo(() => (rpcUrl ? new ethers.providers.JsonRpcProvider(rpcUrl) : null), [rpcUrl]);

  const [bundlers, setBundlers] = useState<BundlerInstance[]>([]);
  const [deployments, setDeployments] = useState<Deployments | null>(null);

  const [owner, setOwner] = useState<HexString | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [sender, setSender] = useState<HexString | null>(null);

  const [tokenInDecimals, setTokenInDecimals] = useState<number>(6);
  const [tokenOutDecimals, setTokenOutDecimals] = useState<number>(18);
  const [tokenInSymbol, setTokenInSymbol] = useState<string>("tokenIn");
  const [tokenOutSymbol, setTokenOutSymbol] = useState<string>("tokenOut");

  const [amountInUi, setAmountInUi] = useState<string>("1000");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [selectedBundlerId, setSelectedBundlerId] = useState<string>("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteNowSec, setQuoteNowSec] = useState<number>(Math.floor(Date.now() / 1000));

  const [step, setStep] = useState<SwapStep>("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [userOpHash, setUserOpHash] = useState<HexString | null>(null);
  const [txHash, setTxHash] = useState<HexString | null>(null);
  const [showPayGas, setShowPayGas] = useState<boolean>(false);
  const [use7702, setUse7702] = useState<boolean>(false);

  const [devWallet, setDevWallet] = useState<ethers.Wallet | null>(null);

  const [pmBalances, setPmBalances] = useState<{ eth: string; tokenIn: string; tokenOut: string }>({
    eth: "0",
    tokenIn: "0",
    tokenOut: "0",
  });
  const [bundlerBalances, setBundlerBalances] = useState<Record<string, string>>({});

  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  // tick for quote countdown
  useEffect(() => {
    const t = setInterval(() => setQuoteNowSec(Math.floor(Date.now() / 1000)), 250);
    return () => clearInterval(t);
  }, []);

  // load bundlers + deployments
  useEffect(() => {
    (async () => {
      try {
        if (monitorUrl) {
          const [b, d] = await Promise.all([fetchBundlers(monitorUrl), fetchDeployments(monitorUrl)]);
          setBundlers(b);
          setDeployments(d);
          if (b.length > 0) setSelectedBundlerId(b[0].id);
        }
      } catch (e: any) {
        setStatusMsg(e?.message ?? "Failed to load monitor data");
      }
    })();
  }, [monitorUrl]);

  // fetch bundler addresses
  useEffect(() => {
    if (bundlers.length === 0) return;
    (async () => {
      const updated = await Promise.all(
        bundlers.map(async (b) => {
          if (b.address || !b.rpcUrl || b.status !== "UP") return b;
          try {
            const accounts = await jsonRpcCall<HexString[]>(b.rpcUrl, "eth_accounts", []);
            if (accounts?.[0]) return { ...b, address: accounts[0] };
            return b;
          } catch {
            return b;
          }
        }),
      );
      if (JSON.stringify(updated.map(u => u.address)) !== JSON.stringify(bundlers.map(b => b.address))) {
        setBundlers(updated);
      }
    })();
  }, [bundlers]);

  // poll for balances
  useEffect(() => {
    if (!readProvider || !deployments) return;
    const update = async () => {
      try {
        const erc20 = new ethers.utils.Interface(["function balanceOf(address) view returns (uint256)"]);
        const pm = deployments.paymaster;
        const [eth, tIn, tOut] = await Promise.all([
          readProvider.getBalance(pm),
          new ethers.Contract(deployments.tokenIn, erc20, readProvider).balanceOf(pm),
          new ethers.Contract(deployments.tokenOut, erc20, readProvider).balanceOf(pm),
        ]);
        setPmBalances({
          eth: eth.toString(),
          tokenIn: tIn.toString(),
          tokenOut: tOut.toString(),
        });

        const balances: Record<string, string> = {};
        await Promise.all(
          bundlers.map(async (b) => {
            if (b.address) {
              try {
                const bal = await readProvider.getBalance(b.address);
                balances[b.id] = bal.toString();
              } catch {
                // ignore
              }
            }
          }),
        );
        setBundlerBalances(balances);
      } catch {
        // ignore
      }
    };
    void update();
    const t = setInterval(() => void update(), 5000);
    return () => clearInterval(t);
  }, [readProvider, deployments, bundlers]);

  // telemetry heartbeat (users connected)
  useEffect(() => {
    if (!monitorUrl) return;
    const send = async () => {
      try {
        await fetch(`${monitorUrl}/api/telemetry/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            app: "web",
            owner: owner ?? undefined,
            sender: sender ?? undefined,
          }),
        });
      } catch {
        // ignore (demo)
      }
    };
    void send();
    const t = setInterval(() => void send(), 10_000);
    return () => clearInterval(t);
  }, [monitorUrl, sessionId, owner, sender]);

  // load token metadata
  useEffect(() => {
    if (!readProvider || !deployments) return;
    (async () => {
      try {
        const erc20 = new ethers.utils.Interface([
          "function decimals() view returns (uint8)",
          "function symbol() view returns (string)",
        ]);
        const tokenIn = new ethers.Contract(deployments.tokenIn, erc20, readProvider);
        const tokenOut = new ethers.Contract(deployments.tokenOut, erc20, readProvider);
        const [dIn, sIn, dOut, sOut] = await Promise.all([
          tokenIn.decimals(),
          tokenIn.symbol(),
          tokenOut.decimals(),
          tokenOut.symbol(),
        ]);
        setTokenInDecimals(Number(dIn));
        setTokenOutDecimals(Number(dOut));
        setTokenInSymbol(String(sIn));
        setTokenOutSymbol(String(sOut));
      } catch {
        // ignore (demo)
      }
    })();
  }, [readProvider, deployments]);

  const selectedBundler = bundlers.find((b) => b.id === selectedBundlerId) ?? null;
  const quoteExpired = quote ? quote.expiresAt <= quoteNowSec : false;
  const quoteCountdown = quote ? formatCountdown(Math.max(0, quote.expiresAt - quoteNowSec)) : "";

  async function connect(): Promise<void> {
    if (!readProvider || !deployments) {
      setStatusMsg("Missing VITE_RPC_URL or deployments; start monitor + set env vars.");
      return;
    }

    setStatusMsg("");
    setStep("connecting");

    if (devPrivateKey) {
      try {
        const w = new ethers.Wallet(devPrivateKey, readProvider);
        const addr = (await w.getAddress()) as HexString;
        const net = await readProvider.getNetwork();

        setOwner(addr);
        setChainId(net.chainId);

        // compute counterfactual sender address
        const factory = new ethers.Contract(
          deployments.simpleAccountFactory,
          ["function getAddress(address owner,uint256 salt) view returns (address)"],
          readProvider,
        );
        setSender((await factory.getAddress(addr, 0)) as HexString);

        setDevWallet(w);
        setStep("idle");
        return;
      } catch (e: any) {
        setDevWallet(null);
        setStep("idle");
        setStatusMsg(e?.message ?? "Dev wallet connect failed");
        return;
      }
    }

    if (!window.ethereum) {
      setDevWallet(null);
      setStep("idle");
      setStatusMsg("MetaMask not detected (window.ethereum missing).");
      return;
    }

    const web3 = new ethers.providers.Web3Provider(window.ethereum, "any");
    await web3.send("eth_requestAccounts", []);

    const signer = web3.getSigner();
    const addr = (await signer.getAddress()) as HexString;
    const net = await web3.getNetwork();

    setOwner(addr);
    setChainId(net.chainId);
    setDevWallet(null);

    // compute sender
    if (use7702) {
      setSender(addr);
    } else {
      const factory = new ethers.Contract(
        deployments.simpleAccountFactory,
        ["function getAddress(address owner,uint256 salt) view returns (address)"],
        readProvider,
      );
      setSender((await factory.getAddress(addr, 0)) as HexString);
    }

    setStep("idle");
  }

  // Update sender when use7702 changes if already connected
  useEffect(() => {
    if (!owner || !deployments || !readProvider) return;
    (async () => {
      if (use7702) {
        setSender(owner);
      } else {
        const factory = new ethers.Contract(
          deployments.simpleAccountFactory,
          ["function getAddress(address owner,uint256 salt) view returns (address)"],
          readProvider,
        );
        const counterfactual = await factory.getAddress(owner, 0);
        setSender(counterfactual as HexString);
      }
    })();
  }, [use7702, owner, deployments, readProvider]);

  async function getQuote(): Promise<void> {
    if (!quoteServiceUrl) return setStatusMsg("Missing VITE_QUOTE_SERVICE_URL");
    if (!deployments) return setStatusMsg("Missing deployments");
    if (!sender) return setStatusMsg("Connect wallet first");

    setStatusMsg("");
    setStep("quoting");
    setUserOpHash(null);
    setTxHash(null);
    setShowPayGas(false);

    const amountIn = parseUnitsSafe(amountInUi, tokenInDecimals);
    if (!amountIn || amountIn.lte(0)) {
      setStep("idle");
      return setStatusMsg("Enter a valid amount");
    }

    const req: QuoteRequest = {
      chainId: chainId ?? undefined,
      tokenIn: deployments.tokenIn,
      tokenOut: deployments.tokenOut,
      amountIn: amountIn.toString(),
      slippageBps,
      sender,
    };

    try {
      const q = await fetchQuote(quoteServiceUrl, req);
      setQuote(q);
      setStep("idle");
    } catch (e: any) {
      setStep("idle");
      setStatusMsg(e?.message ?? "Quote failed");
    }
  }

  async function gaslessSwap(): Promise<void> {
    try {
      if (!deployments || !readProvider) return setStatusMsg("Missing deployments/RPC");
      if (!quoteServiceUrl) return setStatusMsg("Missing VITE_QUOTE_SERVICE_URL");
      if (!quote) return setStatusMsg("Get a quote first");
      if (!owner || !sender) return setStatusMsg("Connect wallet first");
      if (!devWallet && !window.ethereum) return setStatusMsg("MetaMask not detected");

      const candidates = (() => {
        const list = bundlers.filter((b) => Boolean(b.rpcUrl));
        const selected = selectedBundlerId ? list.find((b) => b.id === selectedBundlerId) : undefined;
        const rest = list.filter((b) => b.id !== selectedBundlerId);
        rest.sort((a, b) => (a.status === "UP" ? 0 : 1) - (b.status === "UP" ? 0 : 1));
        return [...(selected ? [selected] : []), ...rest];
      })();

      if (candidates.length === 0) return setStatusMsg("No bundlers available (start bundlers / monitor)");

      setStatusMsg("");
      setStep("building");
      setUserOpHash(null);
      setTxHash(null);
      setShowPayGas(false);

      const nowSec = () => Math.floor(Date.now() / 1000);

      const amountInParsed = parseUnitsSafe(amountInUi, tokenInDecimals);
      if (!amountInParsed || amountInParsed.lte(0)) {
        setStep("idle");
        return setStatusMsg("Enter a valid amount");
      }

      // auto rebuild quote if it expired before we asked for a signature
      let activeQuote = quote;
      if (activeQuote.expiresAt <= nowSec()) {
        setStep("quoting");
        setStatusMsg("Quote expired — rebuilding…");
        try {
          activeQuote = await fetchQuote(quoteServiceUrl, {
            chainId: chainId ?? undefined,
            tokenIn: deployments.tokenIn,
            tokenOut: deployments.tokenOut,
            amountIn: amountInParsed.toString(),
            slippageBps,
            sender,
          });
          setQuote(activeQuote);
        } catch (e: any) {
          setStep("idle");
          return setStatusMsg(e?.message ?? "Quote rebuild failed");
        }
        setStep("building");
      }

      const entryPoint = new ethers.Contract(
        deployments.entryPoint,
        [
          ...ENTRYPOINT_ABI,
          "function getNonce(address sender,uint192 key) view returns (uint256)",
          "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
        ],
        readProvider,
      );

      const factoryData = buildFactoryData(owner, 0);

      const paymasterIface = new ethers.utils.Interface([
        "function gasBufferBps() view returns (uint256)",
        "function fixedMarkupWei() view returns (uint256)",
      ]);
      const paymaster = new ethers.Contract(deployments.paymaster, paymasterIface, readProvider);
      const [gasBufferBps, fixedMarkupWei] = await Promise.all([paymaster.gasBufferBps(), paymaster.fixedMarkupWei()]);

      const nonce = await entryPoint.getNonce(sender, 0);
      const senderCode = await readProvider.getCode(sender);
      const needsDeployment = senderCode === "0x";

      // Fee floors: to support automatic bundler failover with a single signature, we pick floors that satisfy all UP bundlers.
      const floorBundlers = candidates.some((b) => b.status === "UP") ? candidates.filter((b) => b.status === "UP") : candidates;
      const minPrioFloor = Math.max(0, ...floorBundlers.map((b) => Number(b.policy.minPriorityFeeGwei ?? 0)));
      const minMaxFloor = Math.max(0, ...floorBundlers.map((b) => Number(b.policy.minMaxFeeGwei ?? 0)));

      const feeData = await readProvider.getFeeData();
      const prio = BigNumber.from(
        feeData.maxPriorityFeePerGas ?? feeData.gasPrice ?? ethers.utils.parseUnits("1", "gwei"),
      );
      const maxFee = BigNumber.from(feeData.maxFeePerGas ?? feeData.gasPrice ?? prio);

      const minPrio = ethers.utils.parseUnits(minPrioFloor.toString(), "gwei");
      const minMax = ethers.utils.parseUnits(minMaxFloor.toString(), "gwei");

      const maxPriorityFeePerGas = prio.gt(minPrio) ? prio : minPrio;
      const maxFeePerGas = maxFee.gt(minMax) ? maxFee : minMax;

      const amountIn = BigNumber.from(activeQuote.amountIn);
      const paymasterVerificationGasLimit = BigNumber.from(200_000);
      const paymasterPostOpGasLimit = BigNumber.from(200_000);

      const placeholderSig = makeNonRevertingDummySignature();

      const mkSponsoredUserOp = (
        feeAmount: BigNumber,
        gas: { callGas: BigNumber; verifGas: BigNumber; preVerifGas: BigNumber },
      ): UserOpV07 => {
        const callData = buildExecuteBatchCallData({
          tokenIn: deployments.tokenIn,
          tokenOut: deployments.tokenOut,
          router: deployments.router,
          paymaster: deployments.paymaster,
          amountIn,
          feeAmount,
          routerSwapCalldata: activeQuote.route.calldata,
        });

        return {
          sender,
          nonce: hexBn(nonce),
          factory: (needsDeployment && !use7702) ? deployments.simpleAccountFactory : undefined,
          factoryData: (needsDeployment && !use7702) ? factoryData : undefined,
          callData,
          callGasLimit: hexBn(gas.callGas),
          verificationGasLimit: hexBn(gas.verifGas),
          preVerificationGas: hexBn(gas.preVerifGas),
          maxFeePerGas: hexBn(maxFeePerGas),
          maxPriorityFeePerGas: hexBn(maxPriorityFeePerGas),
          paymaster: deployments.paymaster,
          paymasterVerificationGasLimit: hexBn(paymasterVerificationGasLimit),
          paymasterPostOpGasLimit: hexBn(paymasterPostOpGasLimit),
          paymasterData: "0x",
          signature: placeholderSig,
          eip7702Auth: null,
        };
      };

      const estimateWithFailover = async (userOp: UserOpV07): Promise<{ gas: any; bundlerId: string }> => {
        const errors: string[] = [];
        for (const b of candidates) {
          setStatusMsg(`Estimating via ${b.name}…`);
          try {
            const result = await jsonRpcCall<{ callGasLimit: string; verificationGasLimit: string; preVerificationGas: string }>(
              b.rpcUrl,
              "eth_estimateUserOperationGas",
              [userOp, deployments.entryPoint],
            );
            return { gas: result, bundlerId: b.id };
          } catch (e: any) {
            errors.push(`${b.name}: ${formatBundlerRpcError(e?.rpc ?? e)}`);
          }
        }
        throw new Error(`All bundlers failed gas estimation:\n${errors.join("\n")}`);
      };

      const feeForGas = (gas: { callGas: BigNumber; verifGas: BigNumber; preVerifGas: BigNumber }): BigNumber => {
        const totalGas = gas.callGas
          .add(gas.verifGas)
          .add(gas.preVerifGas)
          .add(paymasterVerificationGasLimit)
          .add(paymasterPostOpGasLimit);
        const maxCost = totalGas.mul(maxFeePerGas);
        const requiredFee = maxCost.mul(BigNumber.from(10_000).add(gasBufferBps)).div(10_000).add(fixedMarkupWei);
        return requiredFee.mul(101).div(100); // +1% margin
      };

      // Estimation requires the paymaster validation to pass. Since the paymaster checks that `feeAmount >= requiredFee(maxCost)`,
      // we must include a non-zero fee even for the first `eth_estimateUserOperationGas` call.
      const gasGuess = {
        callGas: BigNumber.from(1_500_000),
        verifGas: BigNumber.from(600_000),
        preVerifGas: BigNumber.from(120_000),
      };
      const feeGuess = feeForGas(gasGuess);

      const g1 = await estimateWithFailover(mkSponsoredUserOp(feeGuess, gasGuess));
      if (g1.bundlerId && g1.bundlerId !== selectedBundlerId) setSelectedBundlerId(g1.bundlerId);

      let gas1 = {
        callGas: BigNumber.from(g1.gas.callGasLimit),
        verifGas: BigNumber.from(g1.gas.verificationGasLimit),
        preVerifGas: BigNumber.from(g1.gas.preVerificationGas),
      };

      // Refinement pass: estimate again using the fee derived from the first estimate.
      // This keeps the single-signature flow (all estimation happens before we ask the user to sign).
      let feeAmount = feeForGas(gas1);
      try {
        const g2 = await estimateWithFailover(mkSponsoredUserOp(feeAmount, gas1));
        if (g2.bundlerId && g2.bundlerId !== selectedBundlerId) setSelectedBundlerId(g2.bundlerId);

        gas1 = {
          callGas: BigNumber.from(g2.gas.callGasLimit),
          verifGas: BigNumber.from(g2.gas.verificationGasLimit),
          preVerifGas: BigNumber.from(g2.gas.preVerificationGas),
        };
        feeAmount = feeForGas(gas1);
      } catch {
        // best-effort only (the first estimate is already sufficient to continue)
      }

      if (BigNumber.from(activeQuote.minOut).lt(feeAmount)) {
        setStep("failed");
        setShowPayGas(true);
        return setStatusMsg(
          "Paymaster would reject: swap too small for the required gas buffer fee. Increase amount or try later.",
        );
      }

      // Build final sponsored UserOp (single-signature flow).
      const u1 = mkSponsoredUserOp(feeAmount, gas1);

      if (use7702) {
        setStep("signing");
        setStatusMsg("Authorize EIP-7702 (Delegate EOA to Smart Account)…");
        const signer = devWallet ?? new ethers.providers.Web3Provider(window.ethereum, "any").getSigner();
        // The implementation address for 7702 delegation. We'll use the SimpleAccount (proxy) address for simplicity,
        // but ideally it should be the logic contract. For the demo, the factory-deployed accounts are proxies.
        // We'll use the smartAccount address if it's already deployed, or the implementation from standard libs.
        const auth = await signEIP7702Authorization(signer, deployments.simpleAccountFactory, 0); // simplistic approach for demo
        u1.eip7702Auth = auth;
      }

      // userOpHash is independent of signature, so we can compute it before prompting the user.
      const packed = buildPackedUserOpV07(u1);
      const userOpHashBytes: HexString = (await entryPoint.getUserOpHash(packed)) as HexString;
      setUserOpHash(userOpHashBytes);

      setStep("signing");
      const sig: HexString = devWallet
        ? ((await devWallet.signMessage(ethers.utils.arrayify(userOpHashBytes))) as HexString)
        : ((await new ethers.providers.Web3Provider(window.ethereum, "any")
          .getSigner()
          .signMessage(ethers.utils.arrayify(userOpHashBytes))) as HexString);
      u1.signature = sig;

      setStep("submitting");

      const sendErrors: string[] = [];
      let acceptedBy: string | null = null;
      for (const b of candidates) {
        setStatusMsg(`Submitting to ${b.name}…`);
        if (b.id !== selectedBundlerId) setSelectedBundlerId(b.id);
        try {
          const res = await jsonRpcCall<HexString>(b.rpcUrl, "eth_sendUserOperation", [u1, deployments.entryPoint]);
          // Should equal userOpHashBytes, but trust the chain-computed hash.
          void res;
          acceptedBy = b.id;
          break;
        } catch (e: any) {
          sendErrors.push(`${b.name}: ${formatBundlerRpcError(e?.rpc ?? e)}`);
        }
      }

      if (!acceptedBy) {
        setStep("failed");
        setShowPayGas(true);
        return setStatusMsg(`All bundlers rejected the UserOp:\n${sendErrors.join("\n")}`);
      }

      setStep("confirming");

      const topicUserOp = entryPointIface.getEventTopic("UserOperationEvent");
      const topicRevert = entryPointIface.getEventTopic("UserOperationRevertReason");
      const startBlock = Math.max(0, (await readProvider.getBlockNumber()) - 25);
      const confirmStartMs = Date.now();

      const resendQueue = candidates.filter((b) => b.id !== acceptedBy);
      let resendIndex = 0;
      let nextResendAtMs = Date.now() + 10_000;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // If quote deadline passed, the paymaster validation window is closed and the op cannot be included.
        if (nowSec() > activeQuote.deadline) {
          setStep("failed");
          setShowPayGas(true);
          return setStatusMsg("Quote expired before inclusion. Rebuild quote and retry (requires a new signature).");
        }

        if (Date.now() > nextResendAtMs && resendIndex < resendQueue.length) {
          const b = resendQueue[resendIndex++];
          nextResendAtMs += 10_000;
          setStatusMsg(`No inclusion yet — resubmitting to ${b.name}…`);
          setSelectedBundlerId(b.id);
          try {
            await jsonRpcCall<HexString>(b.rpcUrl, "eth_sendUserOperation", [u1, deployments.entryPoint]);
          } catch {
            // ignore (best-effort failover)
          }
        }

        try {
          const logs = await readProvider.getLogs({
            address: deployments.entryPoint,
            topics: [topicUserOp, userOpHashBytes],
            fromBlock: startBlock,
            toBlock: "latest",
          });

          const hit = logs[0];
          if (hit) {
            const parsed = entryPointIface.parseLog(hit);
            const success = Boolean(parsed.args.success);
            const tx = hit.transactionHash as HexString;
            setTxHash(tx);

            if (success) {
              setStatusMsg("");
              setStep("success");
              return;
            }

            // Best-effort: decode revertReason event from the same tx receipt.
            let reason = "UserOp failed";
            try {
              const receipt = await readProvider.getTransactionReceipt(tx);
              const rlog = receipt.logs.find(
                (l) =>
                  l.address.toLowerCase() === deployments.entryPoint.toLowerCase() &&
                  l.topics[0] === topicRevert &&
                  (l.topics[1] ?? "").toLowerCase() === userOpHashBytes.toLowerCase(),
              );
              if (rlog) {
                const rParsed = entryPointIface.parseLog(rlog);
                const revertBytes = String(rParsed.args.revertReason ?? "0x");
                try {
                  const pm = paymasterErrorsIface.parseError(revertBytes);
                  reason = `Revert: ${pm.name}`;
                } catch {
                  reason = `Revert: ${decodeRevertData(revertBytes)}`;
                }
              }
            } catch {
              // ignore
            }

            setStep("failed");
            setShowPayGas(true);
            setStatusMsg(reason);
            return;
          }
        } catch {
          // ignore transient RPC errors
        }

        if (Date.now() - confirmStartMs > 60_000) {
          setStep("failed");
          setShowPayGas(true);
          setStatusMsg("Timed out waiting for inclusion. Try again or switch bundler.");
          return;
        }

        await sleep(900);
      }
    } catch (e: any) {
      setStep("failed");
      setShowPayGas(true);
      setStatusMsg(e?.message ?? "Swap failed");
    }
  }

  async function paidFallbackSwap(): Promise<void> {
    try {
      if (!deployments || !readProvider) return setStatusMsg("Missing deployments/RPC");
      if (!quoteServiceUrl) return setStatusMsg("Missing VITE_QUOTE_SERVICE_URL");
      if (!quote) return setStatusMsg("Get a quote first");
      if (!owner) return setStatusMsg("Connect wallet first");
      if (!devWallet && !window.ethereum) return setStatusMsg("MetaMask not detected");

      const nowSec = () => Math.floor(Date.now() / 1000);
      const amountInParsed = parseUnitsSafe(amountInUi, tokenInDecimals);
      if (!amountInParsed || amountInParsed.lte(0)) {
        return setStatusMsg("Enter a valid amount");
      }

      setStatusMsg("");
      setStep("submitting");
      setUserOpHash(null);
      if (monitorUrl) {
        void postTelemetryEvent(monitorUrl, "paid_fallback_attempt").catch(() => { });
      }

      let activeQuote = quote;
      if (activeQuote.expiresAt <= nowSec()) {
        setStep("quoting");
        setStatusMsg("Quote expired for paid fallback — rebuilding…");
        activeQuote = await fetchQuote(quoteServiceUrl, {
          chainId: chainId ?? undefined,
          tokenIn: deployments.tokenIn,
          tokenOut: deployments.tokenOut,
          amountIn: amountInParsed.toString(),
          slippageBps,
          sender: sender ?? owner,
        });
        setQuote(activeQuote);
        setStep("submitting");
      }

      const signer = devWallet ?? new ethers.providers.Web3Provider(window.ethereum, "any").getSigner();
      const signerAddr = (await signer.getAddress()) as HexString;
      const amountIn = BigNumber.from(activeQuote.amountIn);

      const erc20 = new ethers.Contract(
        deployments.tokenIn,
        [
          "function allowance(address owner,address spender) view returns (uint256)",
          "function approve(address spender,uint256 amount) returns (bool)",
          "function balanceOf(address owner) view returns (uint256)",
        ],
        signer,
      );
      const balance = await erc20.balanceOf(signerAddr);
      if (BigNumber.from(balance).lt(amountIn)) {
        setStep("failed");
        setShowPayGas(true);
        return setStatusMsg(
          `Insufficient ${tokenInSymbol} in owner wallet for paid fallback. Needed ${formatUnitsSafe(amountIn.toString(), tokenInDecimals)}.`,
        );
      }

      const allowance = await erc20.allowance(signerAddr, deployments.router);
      if (BigNumber.from(allowance).lt(amountIn)) {
        setStatusMsg("Approving token spend for user-paid fallback…");
        const approveTx = await erc20.approve(deployments.router, ethers.constants.MaxUint256);
        await approveTx.wait();
      }

      setStep("confirming");
      setStatusMsg("Submitting user-paid swap…");

      const router = new ethers.Contract(
        deployments.router,
        [
          "function swapExactIn(address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,address to,uint256 deadline) returns (uint256)",
        ],
        signer,
      );

      const tx = await router.swapExactIn(
        deployments.tokenIn,
        deployments.tokenOut,
        amountIn,
        BigNumber.from(activeQuote.minOut),
        signerAddr,
        BigNumber.from(activeQuote.deadline),
      );
      setTxHash(tx.hash as HexString);
      await tx.wait();

      setShowPayGas(false);
      setStatusMsg("User-paid swap confirmed.");
      setStep("success");
      if (monitorUrl) {
        void postTelemetryEvent(monitorUrl, "paid_fallback_success").catch(() => { });
      }
    } catch (e: any) {
      setStep("failed");
      setShowPayGas(true);
      setStatusMsg(e?.message ?? "User-paid fallback swap failed");
      if (monitorUrl) {
        void postTelemetryEvent(monitorUrl, "paid_fallback_failure").catch(() => { });
      }
    }
  }

  const quotePanel = (
    <div className="panel">
      <div className="row space">
        <h2 className="h1">Swap</h2>
        {quote && (
          <span className={`pill ${quoteExpired ? "bad" : "good"}`}>
            {quoteExpired ? "Quote expired" : `Expires in ${quoteCountdown}`}
          </span>
        )}
      </div>

      <div className="label">Amount ({tokenInSymbol})</div>
      <div className="row">
        <input value={amountInUi} onChange={(e) => setAmountInUi(e.target.value)} placeholder="0.0" />
        <button onClick={getQuote} className="primary" disabled={step !== "idle" && step !== "success" && step !== "failed"}>
          Get quote
        </button>
      </div>

      <div style={{ height: 10 }} />

      <div className="label">Slippage (bps)</div>
      <div className="row">
        <input
          value={String(slippageBps)}
          onChange={(e) => setSlippageBps(Number(e.target.value))}
          placeholder="50"
        />
        <span className="pill">{(slippageBps / 100).toFixed(2)}%</span>
      </div>

      <div style={{ height: 10 }} />

      <div className="label">Bundler</div>
      <select value={selectedBundlerId} onChange={(e) => setSelectedBundlerId(e.target.value)}>
        {bundlers.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} — {b.policy.strict ? "Strict" : "Fast"} — minPrio {b.policy.minPriorityFeeGwei ?? 0} gwei
          </option>
        ))}
      </select>

      <div style={{ height: 12 }} />

      <div className="row space">
        <div>
          <div className="label">Expected out</div>
          <div className="mono">
            {quote ? `${formatUnitsSafe(quote.amountOut, tokenOutDecimals)} ${tokenOutSymbol}` : "—"}
          </div>
        </div>
        <div>
          <div className="label">Min out</div>
          <div className="mono">
            {quote ? `${formatUnitsSafe(quote.minOut, tokenOutDecimals)} ${tokenOutSymbol}` : "—"}
          </div>
        </div>
      </div>

      <div style={{ height: 14 }} />

      {(() => {
        const canAction = step === "idle" || step === "success" || step === "failed";
        return (
          <div style={{ display: "grid", gap: 10 }}>
            <button className="primary" onClick={gaslessSwap} disabled={!quote || !canAction}>
              Gasless Swap
            </button>

            {step === "failed" && (
              <div className="row">
                <button onClick={getQuote} disabled={!canAction}>Rebuild quote</button>
                <button onClick={gaslessSwap} disabled={!quote || !canAction}>Retry</button>
              </div>
            )}
          </div>
        );
      })()}

      {statusMsg && (
        <div style={{ marginTop: 10 }} className="mono">
          {statusMsg}
        </div>
      )}

      {step === "failed" && showPayGas && (
        <div style={{ marginTop: 12 }} className="mono">
          <div style={{ marginBottom: 6 }}><span className="pill">Fallback</span> Pay gas yourself</div>
          <div style={{ marginBottom: 8 }}>
            <button onClick={paidFallbackSwap}>Swap paying gas</button>
          </div>
          <div>
            If sponsorship is denied or bundlers are unhealthy, you can still complete the swap by paying gas (AVAX/ETH).
            This demo’s default path is always gasless; this option only appears on failures.
          </div>
        </div>
      )}
    </div>
  );

  const statusPanel = (
    <div className="panel">
      <div className="row space">
        <h2 className="h1">Status</h2>
        <span className="pill">{chainId ? `Chain ${chainId}` : "No wallet"}</span>
      </div>

      <div className="row space">
        <div>
          <div className="label">Owner (EOA)</div>
          <div className="mono">{owner ? <AddressDisplay address={owner} /> : "—"}</div>
        </div>
        <div>
          <div className="label">Smart Account</div>
          <div className="mono">{sender ? <AddressDisplay address={sender} /> : "—"}</div>
        </div>
      </div>

      <div style={{ height: 10 }} />

      <button onClick={connect} disabled={step !== "idle" && step !== "success" && step !== "failed"}>
        {owner ? "Reconnect" : devPrivateKey ? "Connect Dev Wallet" : "Connect MetaMask"}
      </button>

      <div style={{ height: 12 }} />

      <div className="row space" style={{ background: "rgba(255,255,255,0.05)", padding: "10px", borderRadius: "8px" }}>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>EIP-7702 Mode</div>
          <div style={{ fontSize: "0.8em", opacity: 0.7 }}>Delegate EOA to Smart Account</div>
        </div>
        <button
          className={use7702 ? "good" : ""}
          style={{ width: "auto", padding: "4px 12px" }}
          onClick={() => setUse7702(!use7702)}
          disabled={step !== "idle" && step !== "success" && step !== "failed"}
        >
          {use7702 ? "ON (Traditional Wallet)" : "OFF (Smart Account)"}
        </button>
      </div>

      <div style={{ height: 12 }} />

      <div className="steps">
        {([
          ["quoting", "Quote requested"],
          ["building", "Build UserOperation"],
          ["signing", "Signature requested"],
          ["submitting", "Submitted to bundler"],
          ["confirming", "Included on-chain"],
          ["success", "Swap success"],
          ["failed", "Swap failed"],
        ] as Array<[SwapStep, string]>).map(([k, label]) => (
          <div key={k} className={`step ${step === k ? "active" : ""}`}>
            <div className="name">{label}</div>
            <div className="state">{step === k ? (k === "success" ? "done" : "active") : "—"}</div>
          </div>
        ))}
      </div>

      <div style={{ height: 10 }} />

      <div className="label">UserOp</div>
      <div className="mono">{userOpHash ?? "—"}</div>
      <div style={{ height: 8 }} />
      <div className="label">Tx</div>
      <div className="mono">{txHash ?? "—"}</div>
    </div>
  );

  const systemPanel = (
    <div className="panel">
      <h2 className="h1">System Balances</h2>

      <div className="label">Paymaster (<AddressDisplay address={deployments?.paymaster ?? "0x..."} />)</div>
      <div className="row space mono" style={{ fontSize: "0.85em" }}>
        <span>{tokenInSymbol}:</span>
        <span>{formatUnitsSafe(pmBalances.tokenIn, tokenInDecimals)}</span>
      </div>
      <div className="row space mono" style={{ fontSize: "0.85em" }}>
        <span>{tokenOutSymbol}:</span>
        <span>{formatUnitsSafe(pmBalances.tokenOut, tokenOutDecimals)}</span>
      </div>
      <div className="row space mono" style={{ fontSize: "0.85em" }}>
        <span>Gas (ETH/AVAX):</span>
        <span>{formatUnitsSafe(pmBalances.eth, 18)}</span>
      </div>

      <div style={{ height: 12 }} />
      <div className="label">Bundlers</div>
      {bundlers.map(b => (
        <div key={b.id} style={{ marginBottom: 8 }}>
          <div className="row space" style={{ fontSize: "0.85em" }}>
            <span className="mono">{b.name}</span>
            <span className={`pill ${b.status === "UP" ? "good" : "bad"}`} style={{ padding: "1px 6px" }}>{b.status}</span>
          </div>
          <div className="row space mono" style={{ fontSize: "0.85em", opacity: 0.8 }}>
            <span>{b.address ? <AddressDisplay address={b.address} /> : "—"}</span>
            <span>{bundlerBalances[b.id] ? formatUnitsSafe(bundlerBalances[b.id], 18) : "—"} ETH</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="window">
      <div className="titlebar">
        <div className="title">Gasless Swap (ERC‑4337 v0.7)</div>
        <div className="pill">{selectedBundler ? selectedBundler.status : "No bundlers"}</div>
      </div>
      <div className="content">
        {quotePanel}
        {statusPanel}
        {systemPanel}
      </div>
      <div style={{ padding: "0 18px 18px 18px" }} className="mono">
        {monitorUrl && quoteServiceUrl && rpcUrl ? (
          <>
            monitor: {monitorUrl} • quote: {quoteServiceUrl} • rpc: {rpcUrl}
          </>
        ) : (
          <>Set `VITE_RPC_URL`, `VITE_MONITOR_URL`, `VITE_QUOTE_SERVICE_URL`.</>
        )}
      </div>
    </div>
  );
}
