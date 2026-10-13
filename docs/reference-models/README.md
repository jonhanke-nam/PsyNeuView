# Reference Model Walkthroughs

**Model-centric** guides — one per bundled reference model — that introduce
*what a model is* and *how to see it work* in PsyNeuView.

These are a **distinct category** from the [task tutorials](../tutorials/),
which teach *workflows* (loading, running, editing…) using a model as the
vehicle. A walkthrough here answers "what is the Botvinick model, and how do I
run it?" rather than "how do I run *a* model?".

Like the tutorials, each walkthrough's screenshots are captured from the live
app by a paired spec (`frontend/e2e/tutorials/models/<key>.model.spec.ts`), which
also re-verifies the model loads and runs — so these pages can't drift.

## The models

| Model | Phenomenon | Walkthrough |
|---|---|---|
| Botvinick | Conflict monitoring & cognitive control (Stroop) | [botvinick.md](botvinick.md) |
| Stroop — Basic | Color-word interference | [stroop-basic.md](stroop-basic.md) |
| Stroop — with LC | Stroop + locus-coeruleus gain | [stroop-with-lc.md](stroop-with-lc.md) |
| Cohen–Huston 1994 | Bidirectional Stroop | [cohen-huston-1994.md](cohen-huston-1994.md) |
| Cohen–Huston Horse Race | Stroop horse-race | [cohen-huston-horse-race.md](cohen-huston-horse-race.md) |
| Kalanthroff PCTC 2018 | Task conflict & proactive control | [kalanthroff-pctc.md](kalanthroff-pctc.md) |
| Gilzenrat | Locus-coeruleus gain model (LC/NE) | [gilzenrat.md](gilzenrat.md) |
| Nieuwenhuis 2005 | LC / P300 | [nieuwenhuis-2005.md](nieuwenhuis-2005.md) |
| MontagueDayanSejnowski 96 | TD learning / dopamine | [montague-dayan-sejnowski.md](montague-dayan-sejnowski.md) |
| EGO (Giallanza 2024) | Episodic Generalization & Optimization | [ego.md](ego.md) |

## Coverage guarantee (enforced)

Every bundled reference model has a walkthrough at this level (#886). A **monitor
guard** in `frontend/e2e/tutorials/models/model-walkthroughs.spec.ts` fails CI if
a new model is added without a walkthrough, and flags a walkthrough whose model
was dropped — so coverage can't silently regress in either direction. The same
spec captures every page's screenshots and re-verifies load + run, so these pages
stay in sync with the app.
