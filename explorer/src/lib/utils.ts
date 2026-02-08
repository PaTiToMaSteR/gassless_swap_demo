import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function truncateHash(hash: string, start = 6, end = 4) {
    if (!hash) return '';
    return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

export function formatEth(wei: bigint | string | number) {
    if (!wei || wei === '0' || wei === 0) return '0.00000000';
    try {
        const val = typeof wei === 'bigint' ? wei : BigInt(wei);
        const eth = Number(val) / 1e18;
        if (eth === 0) return '0.00000000';
        if (eth < 1e-8) return eth.toFixed(18).replace(/\.?0+$/, "");
        return eth < 0.0001 ? eth.toFixed(8) : eth.toFixed(4);
    } catch {
        return '0.00000000';
    }
}
