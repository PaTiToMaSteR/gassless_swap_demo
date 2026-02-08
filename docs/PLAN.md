# docs/PLAN

The `docs/` folder is reference material. The implementation is expected to mirror:

- the **token swap interaction sequence** (User → Quote → Bundler → EntryPoint → Smart Account → Paymaster → Router)
- the **on-chain vs off-chain split**
- the **paymaster sponsorship decision flow**
- the **failure handling UX**

When we implement code, we will:

- keep these images unchanged as “requirements”
- ensure each major box has a corresponding folder/component in the repo
- keep the step names consistent with admin metrics and logs (so the story is easy to tell)

