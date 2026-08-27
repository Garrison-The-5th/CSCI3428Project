# Outbound email

The app sends three things: an assignment notice, a "there is more to do"
notice when a finished course gains content, and an admin broadcast to
subscribers. All of it goes over SMTP with an app password, from one mailbox.

Everything is sent **as that mailbox and nothing else**. SPF and DKIM only align
for the account the app password belongs to, so the From address cannot be the
assigning author's; there is no Reply-To and no author signature, because a
placeholder profile in the identity provider used to end up in both.

## Environment

| Variable             | Required | Default          | Notes                                                   |
| -------------------- | -------- | ---------------- | ------------------------------------------------------- |
| `EMAIL_USER`         | yes      | —                | The mailbox, e.g. `noreply@ttgteams.com`                 |
| `EMAIL_APP_PASSWORD` | yes      | —                | Google app password. Spaces and newlines are stripped    |
| `SMTP_HOST`          | no       | `smtp.gmail.com` | An internal relay goes here                             |
| `SMTP_PORT`          | no       | `465`            | 465 is implicit TLS; anything else is STARTTLS, required |
| `APP_BASE_URL`       | in prod  | `http://localhost:5173` | Every link in every message is built from this    |

With `EMAIL_USER` or `EMAIL_APP_PASSWORD` missing, nothing is sent: messages are
logged with the assignment link masked, assigning still works, and the author is
told plainly that email is not configured. That is the intended state for a
local checkout and a bug in a deployment.

`APP_BASE_URL` is the quiet one. Unset, it falls back to the dev host, and mail
that sends perfectly carries links to `localhost:5173`.

## Is it working? Read the boot log

The backend says what it can do at startup, so this never needs guessing:

```
email enabled   relay=smtp.gmail.com:465 secure=true as n***@ttgteams.com
smtp ready      relay=smtp.gmail.com:465
```

That second line is a real authenticated SMTP session, opened and closed without
sending anything. If it says something else:

| Log line                                    | Meaning                                                     |
| ------------------------------------------- | ----------------------------------------------------------- |
| `email disabled: ... are unset`             | No credentials in the environment. Check the Secret          |
| `smtp unavailable: ... rejected the app password` | Wrong or revoked app password                          |
| `smtp unavailable: ... could not be reached`| Egress to the relay is blocked, or the host is wrong         |
| `APP_BASE_URL is unset`                     | Mail will send with dead links                               |

To check credentials without restarting anything, from a running container:

```bash
node -e "require('./build/src/services/email-service/email-service.js').default
  .verifyConnection().then(r => console.log(r))"
```

## Deploying

Runtime configuration comes from the Secret in `k8s-gitops` under
`apps/learning-app`, not from this repo — `.env` is gitignored and excluded from
every build context, so nothing set locally can reach a cluster. Adding email to
a deployment means adding `EMAIL_USER` and `EMAIL_APP_PASSWORD` to that Secret
alongside `PUBLICKEY`, then rolling the pods.

Encode the values with `printf`, not `echo`: `echo` appends a newline, which
lands inside the secret value. The app strips a trailing newline from the
password defensively, but not from anything else.

If the cluster blocks outbound 465, set `SMTP_PORT=587` — the session then
starts in the clear and STARTTLS is mandatory, so the password is never sent in
plaintext. A connection that goes nowhere fails in ten seconds rather than
hanging the request that triggered it.
