# Review a Quantum Cat

Anyone can inspect the code, download the public records, and reproduce a cat's
trait selection. Owning an NFT or connecting a wallet is optional.

There are two checks with different access requirements:

| Check | Access needed | What it establishes |
| --- | --- | --- |
| Public-record verification | Public RPC, source, and archived JSON | The file matches its on-chain hash; the assigned shot matches the NFT DNA; the published circuit and trait mapping are consistent |
| Direct IBM comparison | Your own IBM credentials and Reader access to the originating instance | A fresh IBM retrieval agrees with the archived job, shots, backend, timestamps, submitted circuit, and execution options |

## 1. Verify the public record

Clone this repository and install the Node and Python dependencies listed in
[README.md](README.md#setup). The existing records are in [archive/](archive/).
For a reproducible public testnet example:

```bash
export RPC_URL=https://rpc.testnet.chain.robinhood.com
export CONTRACT_ADDRESS=0xc6b3eafeb626662f6e6353441bce232419d58747
node verify.mjs 1
```

The verifier prints each check and the decoded traits. Token 1 receives shot 0
of IBM job `daeinh642tqs73aupkm0`; token 2 receives shot 1. Change the RPC,
contract, and token ID to inspect another deployment. Download a newer batch's
`archive/job-<jobId>.json` from this repository, or pass `--archive /path/file.json`.

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

1. Create your own IBM Cloud account.
2. The worker invites that account and assigns the collection's Reader access.
3. Accept IBM's invitation and select the invited account and relevant instance
   in IBM Quantum Platform. Inspect the job ID, status, results, and submitted circuit.
4. Use your own IBM Quantum API key to run the direct comparison:

```bash
# Read the key without displaying it or placing its value in shell history.
read -r -s -p 'Your IBM Quantum API key: ' IBM_QUANTUM_TOKEN; printf '\n'
export IBM_QUANTUM_TOKEN
node verify.mjs 1 --ibm
unset IBM_QUANTUM_TOKEN
```

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
