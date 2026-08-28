# Outbound email

The app sends three things: an assignment notice, a "there is more to do"
notice when a finished course gains content, and an admin broadcast to
subscribers. All of it goes over SMTP with an app password, from one mailbox.

Everything is sent **as that mailbox and nothing else**. SPF and DKIM only align
for the account the app password belongs to, so the From address cannot be the
assigning author's; there is no Reply-To and no author signature, because a
placeholder profile in the identity provider used to end up in both.

## Environment

| Variable             | Required | Default                | Notes                                                    |
| -------------------- | -------- | ---------------------- | -------------------------------------------------------- |
| `EMAIL_USER`         | yes      | —                      | The mailbox, e.g. `noreply@ttgteams.com`                 |
| `EMAIL_APP_PASSWORD` | yes      | —                      | Google app password. Spaces and newlines are stripped    |
| `SMTP_HOST`          | no       | `smtp.gmail.com`       | An internal relay goes here                              |
| `SMTP_PORT`          | no       | `465`                  | 465 is implicit TLS; anything else is STARTTLS, required |
| `APP_BASE_URL`       | no       | the request's own host | Pins every link in every message to one address          |

With `EMAIL_USER` or `EMAIL_APP_PASSWORD` missing, nothing is sent: messages are
logged with the assignment link masked, assigning still works, and the author is
told plainly that email is not configured. That is the intended state for a
local checkout and a bug in a deployment.

`APP_BASE_URL` used to be the quiet one: unset, it fell back to the dev host, so
mail that sent perfectly carried links to `localhost:5173` — which is what every
deployment was doing, because nothing sets it.

Links are now built on the host the request that triggered the mail arrived on
(`config/app-url.ts`). An author clicking Assign on `learning.ttgteams.com`
reaches the API on that same host — deployed, the frontend and the API are one
origin, with `/api` routed to the backend — so the link lands where the app
actually is and cannot drift from it. Locally the two are separate ports and the
request carries the API's, so a loopback host is discarded in favour of the Vite
dev server.

Set `APP_BASE_URL` when you want the address pinned rather than observed: it
overrides the request, it is the only source a caller cannot influence with a
`Host` header, and it is what a split deployment needs, where the address the
author uses is not the address to send learners to. It also covers mail sent
with no request in scope at all.

## Is it working? Read the boot log

The backend says what it can do at startup, so this never needs guessing:

```
email enabled   relay=smtp.gmail.com:465 secure=true as n***@ttgteams.com
smtp ready      relay=smtp.gmail.com:465
```

That second line is a real authenticated SMTP session, opened and closed without
sending anything. If it says something else:

| Log line                                          | Meaning                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `email disabled: ... are unset`                   | No credentials in the environment. Check the Secret               |
| `smtp unavailable: ... rejected the app password` | Wrong or revoked app password                                     |
| `smtp unavailable: ... could not be reached`      | Egress to the relay is blocked, or the host is wrong              |
| `APP_BASE_URL is unset`                           | Links follow the host each request arrives on. Set it to pin them |

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
