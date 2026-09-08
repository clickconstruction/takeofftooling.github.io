# Letting a new estimator in

A new estimator joins and needs the app on their laptop. Most of the time you do
nothing at all — they let themselves in. The only thing anyone has to do by hand
is decide whether they are a plain user or an admin.

## They sign themselves in

There is no invitation to send and no account to create.

1. They open the site. The app works immediately, signed out — they can build a
   bid before anyone gives them anything.
2. When they want the same bids on a second machine, they press **Sign In**, type
   their work email, and press **Email me a 6-digit sign-in code**.
3. They type the code from their inbox. That signs them in **and creates the
   account if they don't have one.** They land as a plain **user**.
4. Signed in, **Set a password** in the same dialog means they don't wait for a
   code every time. If they forget it later, **Forgot your password?** on the
   sign-in screen emails them a reset.

That's the whole onboarding. Nothing is provisioned, nothing is handed over out
of band, and no admin is in the loop.

## The three roles

| Role | What it unlocks |
|---|---|
| **user** | the app. Bids, the book, sync, sharing corrections back. This is everybody. |
| **admin** | plus **Update Supplier Prices** and **Export Groups & Sections** in the book's footer, and **Review suggestions** in the ☰ menu. |
| **dev** | plus **Manage users** in the ☰ menu. |

A `user` does not see the admin buttons greyed out — they are not rendered at
all. Signed out, none of the three appear for anyone.

## Change someone's role

**Manage users is dev-only.** An admin does not have it, and an admin who reaches
the screen another way sees *"No users visible — the dev role is required."* — the
server does not hand out the list.

1. ☰ → **Manage users**.
2. The table lists every account: **Email · Role · Created · Last sign-in**. Your
   own row is chipped **You**.
3. Change the **Role** dropdown on their row. It saves as you pick it —
   *"Role saved: admin"*

> **What you'll see:** your own role dropdown is disabled, with *"You can't change
> your own role"* on it. A dev cannot demote themselves and leave the shop with no
> dev — that rule is enforced on the server, not just in the screen.

**A role change does not reach them until they sign in again.** The app reads a
person's role when their session starts, so a freshly promoted admin will not see
**Review suggestions** until they reload the page or sign out and back in. Tell
them to reload; it is one keystroke and it saves a support call.

## Remove someone

**Delete** on their row. It asks first, and it says what goes:

> *Delete the account name@company.com? Their cloud data rows are removed with it.
> This can't be undone.*

That removes the account and the copies of their bids and book that were synced.
Anything on their own laptop stays on their own laptop — the app is local-first,
and deleting the account does not reach into their browser. Collect the machine
if that matters.

You cannot delete your own account from here.

## What leaves the machine

Two different questions, and they have different answers.

**Manage users** shows you an account directory: email addresses, roles, the date
each account was created, and when each last signed in. That is all it holds. It
does not show anyone's bids, and there is no screen anywhere in the app that lets
one person read another person's takeoff.

**Signing in** sends that person's own bids, their book and their assemblies to
the cloud, under their account, readable by nobody else. Their job data is theirs.
The one exception is **Improve the shared book**, which they turn on themselves
and which sends book corrections plus their sign-in email — never a bid. See
[Fix a number once, fix it for everyone](sharing-fixes-to-the-book.md).

## Good to know

- Anyone with an email address can create an account with the code. Manage users
  is a directory and a role list, not a gate — treat the app as open to your
  organisation and use roles to control the admin tools.
- Roles are enforced on the server, not by hiding buttons. Hiding the button is a
  courtesy; the refusal underneath is real.
- New accounts always start as `user`.
- **Refresh** at the top of Manage users re-reads the list; the dates read
  `Sep 7, 2026`, or `—` for an account that has never signed in.
- The app itself sends no email except the sign-in code and the password reset.
- If someone's app looks like an estimator's when it should look like an admin's,
  the answer is almost always "they haven't reloaded since you changed it".
