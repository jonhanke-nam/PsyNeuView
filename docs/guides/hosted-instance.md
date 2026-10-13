# The hosted instance — try PsyNeuView with nothing installed

There is a PsyNeuView running on the web, so you can look at it without a
checkout, a toolchain, or a Mac app build.

The address is sent with your invitation.

Sign in with GitHub. Access is limited to a named list; if you get "sign in"
and then a refusal, your account isn't on it yet — ask and it takes a minute
to add.

> **This is a temporary demo, not a service.** It exists so people can see the
> tool quickly. It can be torn down or rebuilt at any time, and nothing on it
> is backed up. Treat anything you do there as disposable and keep the real
> copy of your work elsewhere.

## The one thing to know before you start

**Everyone who signs in shares the same workspace.** It is a single instance —
one filesystem, one PsyNeuLink worker, one set of saved models. If two people
are in at once they will see each other's files, and a model one person runs
will block the other until it finishes.

That is fine for looking around and for showing someone something. It is not a
place for two people to work at the same time. A per-person deployment is the
plan for the Princeton VM ([#1058][1058] tracks what that needs); this instance
deliberately isn't one.

## Getting your own model in

The server is a container in a data centre, so it cannot see your laptop's
disk. **Open from path…** browses the *container's* filesystem, which means it
only finds the bundled demo and reference models — useful for a first look, no
use for your own work.

Three ways to bring your own:

| What you have | How |
|---|---|
| A `.py` model on your laptop | **Drag it onto the window.** Also under Open → *Import model or project…* |
| A `.pnlproject` bundle | Same — drag it on, or use the Open menu |
| A model in a public GitHub repo | Open → *From GitHub repo…* |
| An MDF file | Open → *Import MDF…* |

Dragging a `.py` sends the file's *contents*, not a path, so it works exactly
the same against a remote instance as it does locally.

## Getting your work back out

**Save a copy as…** in the toolbar. Choose **PsyNeuView Project
(.pnlproject)** or **MDF**, and the file downloads to your computer.

Be careful with the `.py` option: on this instance it writes the file **on the
server**, inside the container — not to your machine. That is confusing enough
that it is being fixed ([#1067][1067] makes the destination an explicit choice
and adds downloading a `.py`).

Until then: **`.pnlproject` is the way to get work off this instance.** It
round-trips — export it here, drag it into a local PsyNeuView, and you have the
model, its layout, and its settings.

## What you cannot change here

The PsyNeuLink version is **fixed by the container image**. The Settings panel
won't offer to switch source or branch, and that is deliberate: the image is
read-only, and pinning the version is what makes the deployment reproducible.
For version experiments, use a local checkout or the Mac app.

## If something looks wrong

Worth knowing what's expected before reporting:

- **Slow first load after a quiet period** — the container may have restarted;
  it takes about 20 seconds to be ready.
- **Someone else's model is open** — see the shared-workspace note above. Not a
  bug.
- **Your saved file vanished** — possible after a redeploy. Nothing here is
  backed up.

Anything else, tell the maintainer who invited you. Logs and the deployment are visible from this
end, so "it did something odd at about 3pm" is usually enough to chase down.

## Where this is going

This instance is the quick-look surface, complementary to the local checkout
and the Mac app rather than a replacement for either — a hosted instance gives
you no visibility into the code or the server, which is exactly what a
developer wants and a reviewer doesn't need.

The durable home is a Princeton VM with one container per person, so each user
gets their own workspace and their own storage — see [#1063][1063] for the
container image that runs there, and [#895][895] for the thread this instance
came out of.

[895]: https://github.com/jonhanke-nam/PsyNeuView/issues/895
[1058]: https://github.com/jonhanke-nam/PsyNeuView/issues/1058
[1063]: https://github.com/jonhanke-nam/PsyNeuView/issues/1063
[1067]: https://github.com/jonhanke-nam/PsyNeuView/issues/1067
