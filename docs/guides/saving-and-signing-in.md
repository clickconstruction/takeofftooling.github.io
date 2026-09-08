# Saving, signing in, and two computers

There is no Save button on the bid, and there is nothing wrong. **The app saves
as you type, in this browser.** Close the laptop, come back tomorrow, and the bid
is where you left it — the rows, the components, the labor rate, the tax rate, the
job details.

The proof is in the header, under the job name.

> **What you'll see:** *Saved just now* while you're typing, *Saved 2 min ago* a
> minute later, then *today* and *yesterday* once it's older.

## What is not saved as you type

One thing: an open **Devices**, **Conduit** or **Wire** editor. Those hold your
parts in a scratch pad until you press **Save parts to the bid** (the conduit
wizard also writes at each step). Leave one by any door in the app and it asks
first — *"Discard unsaved changes in this editor?"* — and so does the browser if
you close the tab or hit reload with an editor dirty. On the bid itself, closing
the tab asks nothing, because there is nothing pending.

## Signing in is optional

The app is complete signed out. Everything above works with no account, and
nothing about your bids leaves this computer.

Sign in for one reason: **so the same bids are on another computer.** The office
desktop and the truck laptop, the same book, the same saved assemblies.

1. Click **Sign In** in the header.
2. Type your email and your password → **Sign In**.
   - No password? Press **Email me a 6-digit sign-in code** instead. The code
     signs you in and creates your account if you don't have one, so a new
     estimator needs nobody's permission to start.
   - Forgot the password you do have? **Forgot your password?** under the
     password box emails you a reset link — fill the email box in first, or it
     answers *Enter your email first.*
3. The header reads **✓ Cloud** and your most recent bid opens.

> **What you'll see:** an account made by emailed code has no password at all. The
> dialog says so — *"You signed in with an emailed code. Set a password below if
> you would rather type one next time."* — and the button under it reads **Set a
> password**, so you can stop waiting for a code every time.

Signed in with a password, that same button reads **Change password**; and signing
out on a shared machine leaves nothing behind for the next person.

## What follows you, and what doesn't

**Syncs:** every bid, separately · your Labor & Price Book · your saved
assemblies · deletions.

**Stays on this computer:** which bid is open · undo history · a supply-house
price file you loaded yourself.

The rules, one line each:

- **A bid:** the newer save wins the name — and the older copy is kept beside it
  rather than thrown away (below).
- **The book:** the newest edit wins, as a whole document.
- **Assemblies:** they add up. Both computers' assemblies end up on both.
- **A delete:** it travels. A bid or an assembly you delete on one machine stays
  deleted on the others.

**Sync now** in the Cloud dialog reconciles this computer with the cloud — the
newer copy wins each way, so it both pulls and pushes. The header button reads
**Syncing…** until your last change has actually gone up, and a sync problem shows
on the button itself as **⚠ Cloud** with the reason on the hover. Your work is on
this computer either way.

## When both computers changed the same bid

Neither copy is thrown away.

> **What you'll see:** the newer one keeps the bid's name; the other is kept
> beside it as **Northgate Retail (conflict — Sep 7, 2:14 PM)**, and a line under
> the header tells you it happened. Open both, take what you need, delete the one
> you don't.

## Working without a signal

The app runs offline. You can open it, edit, price from your book, total the bid
and print — the whole loop, in a truck with no bars.

- **Reload it offline and it still comes up.** The app keeps a copy of itself on
  the device.
- **Install it to the home screen** from your browser's own menu, and it opens
  like an app rather than a tab.
- The **assemblies** side of the book is a large download and is not carried
  offline until you have opened it once with a signal. Until then it says
  *"The parts book is not available offline yet — connect once and it will be
  saved on this device."*
- Anything you type while offline is on the device and goes up the next time you
  have signal.

## Good to know

- Your last change is pushed even if you close the tab or the browser on it — you
  don't have to wait for the checkmark before shutting the lid.
- **Sign Out** sends your last edits up first, then signs out. Everything stays on
  this computer; signing back in does not duplicate it.
- **Reload app (keeps your data)** in the ☰ menu fetches a fresh copy of the app
  itself. It is a repair tool, not a wipe — your bids and your book are untouched.
- Each account sees only its own data.
- A bid you never typed in is never sent up, so new machines don't sprinkle empty
  "Untitled project" rows across your account.
- If the book gets an update from the shared parts book, a line under the header
  names the parts that changed — and only the ones you had not customized.
- Signed out, the app makes no requests to the cloud at all.
