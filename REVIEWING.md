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

[Open a reviewer-access request](https://github.com/quantumcoinputer/quantum-cats/issues/new?template=reviewer-access.yml).
Include the public job or token you want to inspect. Keep your IBM email and all
credentials out of the public issue. Arrange a private contact channel with the
maintainer for the email IBM needs to send the invitation.

1. Create your own IBM Cloud account.
2. The maintainer invites that account and assigns the collection's Reader access.
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

The current process requires a maintainer-issued invitation. The request form
is not automatic enrollment. IBM retains job data subject to its
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

Create an access group named `Quantum Cats Reviewers` in IBM Cloud IAM. Grant
its members the **Reader service role**, restricted to the exact Quantum Compute
instance that contains the collection's jobs. Use the same group for every
reviewer. IBM's standard collaborators group permits job submission, so create
a separate reviewer group with the narrower policy.

The Reader role permits result reads. It does not grant job creation,
cancellation, deletion, or account administration. If reviewers need additional
console resource visibility, add only the necessary instance-scoped Viewer
policy after checking the service's role definitions. Avoid account-wide access.
Instance-level access can include every job in that instance, so keep unrelated
workloads in a separate instance.

Invite each reviewer's IBM account and add it to this group. Future reviewers
inherit the same Reader policy when added, without per-job role changes. IBM
invitations still require the recipient to accept. Accept review requests
regardless of NFT ownership; the account email is needed for the invitation.

An automatic request-and-invitation service is possible as a separate integration.
It would still need each reviewer's identity and acceptance, and must grant only
this instance-scoped Reader group. No automatic invitation service is deployed
in the current site.

[IBM access-group and role documentation](https://quantum.cloud.ibm.com/docs/en/guides/access-groups).
