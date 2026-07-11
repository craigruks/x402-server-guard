# Security Policy

## Disclaimer

This software is provided **"AS IS"**, without warranty of any kind, express or
implied. It is **not audited** and is **not a security guarantee**. It mitigates
specific, enumerated attack classes against x402 payment endpoints. It cannot
make an insecure endpoint safe on its own, and it does not remove your
responsibility to secure your own payment path.

**The authors accept no liability for any loss of funds or damages** arising from
the use of this software. See the [LICENSE](./LICENSE) (MIT) for the full terms.

## Scope

This library targets server-side ("resource server" / merchant) hardening for the
x402 protocol. The attack classes it aims to mitigate, drawn from published
research (arXiv:2605.11781, arXiv:2605.30998), are documented per release in the
README. Anything not listed there is out of scope and should not be assumed
covered.

## Supported versions

Pre-1.0: only the latest published version receives security fixes. The `latest`
dist-tag will never point at code that has not passed review; unreviewed cuts are
published under a separate tag.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| < latest | ❌       |

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** via GitHub Security
Advisories ("Report a vulnerability" on the repository's Security tab), not
through public issues.

Include a description, affected version, and a reproduction if possible. Expect an
acknowledgement within 72 hours. Please allow a reasonable window for a fix before
public disclosure.
