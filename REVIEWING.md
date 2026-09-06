# Review a Quantum Cat

Anyone can inspect the code, download the public records, and reproduce a cat's
trait selection. Owning an NFT or connecting a wallet is optional.

There are two checks with different access requirements:

| Check | Access needed | What it establishes |
| --- | --- | --- |
| Public-record verification | Public RPC, source, and archived JSON | The file matches its on-chain hash; the assigned shot matches the NFT DNA; the published circuit and trait mapping are consistent |
| Direct IBM comparison | Your own IBM credentials and Reader access to the originating instance | A fresh IBM retrieval agrees with the archived job, shots, backend, timestamps, submitted circuit, and execution options |

## 1. Verify the public record

Use Git, Node.js 20 or later, and Python 3.10 or later. These commands are for
Bash on Linux, macOS, or Windows with WSL. Public verification needs no wallet,
private key, IBM account, Foundry installation, or `.env` file.

```bash
git clone https://github.com/quantumcoinputer/quantum-cats.git
cd quantum-cats
npm ci
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-review.txt
```

Keep the virtual environment active when running the verifier: it invokes
`python3` for the circuit checks. If `venv` is unavailable, install your operating
system's Python venv package first. The dependency file records the versions
used for the public and Reader-only checks described below.

For **the live collection on mainnet**, start with this revealed cat:

```bash
export RPC_URL=https://rpc.mainnet.chain.robinhood.com
export CONTRACT_ADDRESS=0xd421a43172873811a8b9E6fFEe23acd263dB837a
node verify.mjs 431
```

The verifier reads the receipt from the contract. Cat 431 belongs to batch 16,
shot index 2 of job `daerfrdnj4cs73afi230` on `ibm_fez`. Shot indices start at
zero, so index 2 means the third measurement in the archive's `bitstrings` array.
The decoded traits include gray fur, tuxedo pattern, violet eyes, a blue beanie,
and interference bits `11100010`. Replace `431` with another revealed token ID.

For the earlier **testnet rehearsal**, explicitly switch both settings:

```bash
export RPC_URL=https://rpc.testnet.chain.robinhood.com
export CONTRACT_ADDRESS=0xc6b3eafeb626662f6e6353441bce232419d58747
node verify.mjs 1
```

Testnet token 1 receives shot 0 of job `daeinh642tqs73aupkm0`; token 2 receives
shot 1. Mainnet and testnet token IDs refer to separate collections.

The checkout includes public archives. For a batch published after you cloned,
run `git pull --ff-only` in a clean checkout. Alternatively, download the exact
JSON file at the **Archive** URL in the NFT metadata or the **on-chain archive URI**
printed by the verifier, then run:

```bash
node verify.mjs 431 --archive /path/to/job-file.json
```

Use the RPC, contract, and token ID for that archive's deployment. The verifier
reads a local file; it prints the archive URL without downloading it automatically.
Preserve downloaded bytes: reformatting JSON changes its hash. The earlier
testnet contract has no archive URL field, so use its file in this repository.
The metadata also exposes **IBM Job ID**, **Batch**, **Shot Index**, **Results Hash**,
and **DNA**. Those are sufficient to locate the record and assigned measurement.

The on-chain hash identifies the exact archive bytes. The shot index fixes which
measurement belongs to the cat. Public mapping tables translate that measurement
into traits. A record fabricated before its hash was committed could still be
internally consistent, so public-record checks alone do not authenticate IBM.

## 2. Compare directly with IBM

[Open the review section](https://quantumcats.art/#review) and select
**Request IBM Reader access**. Enter the email used for your IBM Quantum account
in the popup and submit it. The email is stored privately and a scheduled worker
processes requests every five minutes. No wallet or GitHub account is required. Submit only
the account email; keep API keys and wallet keys private.

GitHub issues remain available for public technical questions. Keep account
emails and credentials out of those issues.

1. Create your own [IBM Cloud account](https://cloud.ibm.com/registration), then
   submit that account's email through the website form.
2. Accept IBM's invitation. In IBM Cloud or IBM Quantum Platform, switch from
   your personal account to the account you were invited to, and locate the
   `quantum-cats-open` instance. Membership is in `Quantum Cats Reviewers`.
3. Open [IBM Quantum Platform](https://quantum.cloud.ibm.com/), select that
   instance, and find the job ID printed by the verifier under Workloads. The
   job's completed status, backend, and results can be inspected there.
4. Create your own API key **while the invited account is selected**. A key
   associated with your personal account can select the wrong instance even
   though the email belongs to the same person. Follow IBM's
   [credential instructions](https://quantum.cloud.ibm.com/docs/en/guides/save-credentials#find-your-access-credentials).
5. Run the direct comparison, keeping the RPC and contract matched to your token:

```bash
# Mainnet example; use the testnet settings above for a testnet token.
export RPC_URL=https://rpc.mainnet.chain.robinhood.com
export CONTRACT_ADDRESS=0xd421a43172873811a8b9E6fFEe23acd263dB837a
# Read the key without displaying it or placing its value in shell history.
read -r -s -p 'Your IBM Quantum API key: ' IBM_QUANTUM_TOKEN; printf '\n'
export IBM_QUANTUM_TOKEN
node verify.mjs 431 --ibm
unset IBM_QUANTUM_TOKEN
```

The key stays on your computer and is sent to IBM for authentication. The
website form accepts only your email. The verifier obtains a fresh IBM record
in a temporary directory, compares every ordered shot plus the job, backend,
timestamps, submitted circuit, and options, then removes the temporary file.
The public archive remains necessary because IBM does not store the project's
logical experiment descriptor as part of its result.

IBM documents that API keys are associated with the account in which they were
created: [QiskitRuntimeService authentication](https://quantum.cloud.ibm.com/docs/en/api/qiskit-ibm-runtime/qiskit-runtime-service).

The website confirms that the request was saved. The server then processes the
request; new reviewers accept an IBM invitation. Existing account members can
receive Reader membership directly. Queue size and provider availability can
extend processing time. IBM retains job data subject to its
[retention policy](https://quantum.cloud.ibm.com/docs/en/guides/secure-data), so
perform direct comparisons while the source records remain available.

Exit codes: **0** means all checks required for the selected mode completed;
**1** means a disagreement; **2** means incomplete verification. A requested
live IBM check that lacks access returns incomplete. IBM remains the trusted
hardware provider; this workflow does not produce an IBM digital signature.

## Interpreting results and resolving problems

- Public verification expects checks 1 through 6 to pass. Check 7 is skipped
  until you add `--ibm`. Archive consistency alone does not authenticate IBM.
- Direct comparison expects all seven checks to pass and exit code 0.
- A boxed token has no revealed measurement yet. Retry after its batch reveals.
- **Archive missing:** update the checkout or download the exact file using the
  receipt's archive URL and pass `--archive`.
- **Python module or circuit check unavailable:** activate `.venv` in this shell
  and rerun the dependency installation above.
- **RPC request failed / ordering inconclusive:** retry after a short pause.
  If it persists, use another RPC for the same chain. For older batches, the
  default event scan covers the most recent five million blocks. Set
  `VERIFY_FROM_BLOCK` to the deployment block, or `0` for a complete, slower scan.
- **IBM retrieval unavailable / no instances / job not found:** confirm the
  invitation was accepted, the invited account was selected when creating the
  API key, and the target instance is `quantum-cats-open`. Data retention and
  provider outages can also prevent retrieval. An incomplete check establishes
  neither a match nor a mismatch.
- **FAIL:** retain the output and report which check disagreed in a GitHub issue.
  Include chain, contract, token ID, and job ID. Keep API keys and email addresses
  private. JSON serialization changes can also cause a mismatch that needs review.

### Reproduction check, 2026-09-06

An anonymous clone, fresh Python virtual environment, and empty inherited
credential environment passed public verification for mainnet Cat 431 and
testnet Cat 1. The mainnet archive was also downloaded directly from the URL
in the on-chain receipt and matched its hash. Changing the assigned shot in a
local copy produced failures for archive integrity and DNA selection.

A temporary service identity with only the existing reviewer group's
instance-scoped Reader policy passed all seven checks for mainnet Cat 431,
including a fresh IBM comparison of all 1,024 ordered shots. It had no direct
IAM policies or privileged group memberships and was deleted, including its
API key, after the test. One attempt encountered an RPC timing-audit error;
retrying passed. This exercises the Reader API permissions. A service identity
does not exercise a person's mailbox invitation acceptance or IBM console UI.

## Why access cannot simply be anonymous

IBM's Quantum job APIs require authenticated, authorized access. IBM Cloud has a
Public Access group, but its documentation identifies Object Storage as the
supported resource type for anonymous public access. It does not document that
switch for Quantum jobs. Publishing the archive makes the evidence accessible;
it does not change IBM's job permissions.

Sources: [IBM public-access scope](https://cloud.ibm.com/docs/account?topic=account-public),
[job API authorization](https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest/tags/jobs),
[inviting users](https://quantum.cloud.ibm.com/docs/en/guides/invite-and-manage-users).

## Maintainer setup

The `Quantum Cats Reviewers` access group is configured in IBM Cloud IAM with
the **Reader service role**, restricted to the collection's `quantum-cats-open`
instance. Use this group for reviewers. For any future originating instance,
configure and verify the same restricted Reader policy. IBM's standard
collaborators group permits job submission, so keep reviewer access separate.

The Reader role permits result reads. It does not grant job creation,
cancellation, deletion, or account administration. If reviewers need additional
console resource visibility, review the required instance-scoped policy first.
The automatic worker requires exactly the configured Reader policy and stops if
its roles or scope change. Avoid account-wide access.
Instance-level access can include every job in that instance, so keep unrelated
workloads in a separate instance.

The scheduled worker invites each reviewer's IBM account into this group. Future reviewers
inherit the same Reader policy when added, without per-job role changes. IBM
invitations require the recipient to accept. Requests are processed regardless of
NFT ownership; the account email is needed for the invitation.

Website requests are in the site's private Netlify Blobs store,
`quantum-cats-reviewer-requests`, under `requests/`. Access it through the
authenticated Netlify project dashboard. The popup has no public request-listing
endpoint and makes no IBM calls. The private worker records request status and
invitation progress here. Remove contact records when no longer needed. Treat each email
as a request, not proof of account ownership; the recipient must accept IBM's
invitation. The form enforces input validation and submission limits.

The host's `quantum-cats-reviewers.timer` runs every five minutes and catches up
after downtime. Provider failures are retried, successful grants are recorded,
and the two deployment test addresses are skipped. The exact Reader policy is
checked before grants. The worker cannot be directed to another role by a form
submission. Interrupted invitations are reconciled against IBM records; ambiguous
outcomes are never blindly resent. Requests unconfirmed for 24 hours require
operator inspection while reconciliation continues. Operational instructions are
in the [site repository](https://github.com/quantumcoinputer/quantum-cats-site#scheduled-reader-invitations).

[IBM access-group and role documentation](https://quantum.cloud.ibm.com/docs/en/guides/access-groups).
