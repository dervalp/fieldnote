# fieldnote — Make the next improvement obvious

Review proposal · 14 September 2026 · Not an approved implementation spec

## Recommendation

Keep the hero. Build the rest of the page around one repository moving from an observable gap to a concrete improvement, then to evidence worth monitoring.

The visitor should leave thinking: **“I can see what my agents are missing, decide what to improve, and inspect what happens next.”**

Audience hypothesis: hands-on developers and technical leads already using coding agents, who want a better working environment for those agents. This is inferred from the brief and product, not validated audience research. Their likely question is “What should I change next?” A score gets attention; an actionable explanation gives them a reason to connect a repository.

## Why the page feels flat

The current sequence is hero → six tiers → five rubric checks → three product stages → metric table → four guarantees → signup. It asks visitors to learn the product's taxonomy before demonstrating its usefulness.

The CSS reinforces that sequence with repeated section padding, top borders, small cards, and similar heading placement. The hero has movement and a focal object; subsequent sections largely present inventories. This assessment is based on the components and styles, not a rendered browser audit.

## Three possible directions

| Direction | Experience | Advantage | Trade-off |
| --- | --- | --- | --- |
| **A. The improvement walkthrough — recommended** | Follow one example from missing instructions to a concrete change and subsequent monitoring. | Makes the next action tangible; fits people improving their harness. | Needs carefully chosen evidence and an accurate product example. |
| B. The evidence workbench | Lead with a PR replay: failed CI, changed test, green result, inspectable verdict. | Most distinctive demonstration of existing monitoring capabilities. | Can position fieldnote primarily as an auditing tool. |
| C. The progression journey | Make tiers a large visual ascent, showing what earns each step. | Strong connection to the hero's collectible card and sense of progress. | Risks making the grade feel like the objective; a high readiness score is not proof of better agent output. |

Use A as the structure, borrow B for one dramatic proof section, and retain C as a compact reward moment.

## Page storyboard

### 0. Hero — preserve

Keep the existing headline, grade card, visual identity, and animation. Its job is aspiration. The next section must explain how the visitor can act on that aspiration.

### 1. Recognition — a short editorial bridge

**Headline:** “Give your agents less to guess.”

**Copy:** “Where to start. How to run the project. What to check before calling it done. Make the basics explicit—and see which ones are missing.”

**Layout:** A large statement on the left; three compact question-and-artifact rows on the right. Avoid enclosing them in separate cards.

| Agent question | Repository evidence |
| --- | --- |
| How does this project work? | Root agent instructions and README |
| How do I get it running? | Documented setup commands |
| How do I verify my change? | Documented test commands |

**Motion:** A subtle highlight moves from each question to its corresponding artifact once as the section enters view. The content stays readable before and after playback.

### 2. Main demonstration — the next useful change

**Headline:** “Know what to improve next.”

**Copy:** “Start with a failing readiness check. See what fieldnote looked for, what it found, and the change you can make.”

**Layout:** A large product demonstration takes roughly two-thirds of the width. A short three-step narrative sits beside it: inspect the gap → add the missing guidance → grade the updated commit. A desktop sticky panel can keep the evidence visible while the steps progress; mobile uses a normal vertical sequence.

**Example:** A sample repository is missing documented test commands. Show the failing check and the searched locations, then an illustrative README change documenting the repository's actual test command, then the resulting check state. Absence should show searched paths; do not invent a line range for a file that does not exist.

**Interaction:** Three accessible step buttons let visitors inspect each state. On desktop, scrolling may also update the selected step without capturing the scroll. Clearly label the entire sequence “Illustrative repository.” Any score shown must come from a fixture evaluated by the actual grader.

**Motion:** Carry the selected check into the document view, highlight the added guidance, and update the grade only after the new commit is shown. This gives the hero's score movement a visible reason.

**Value:** The visitor sees an actionable gap, not just a number. Do not imply that passing a documentation check proves the command works or the documentation is good.

### 3. Contrast section — inspect what green hides

**Headline:** “CI went green. What changed?”

**Copy:** “Follow the revisions behind the result. See when a test or other harness file changed after a failure.”

**Layout:** A full-width dark ink band interrupts the light page. One oversized PR timeline replaces a collection of small cards. Three connected events: failed CI → test file changed → CI passed. Underneath, reveal the existing example's verdict: “Harness changed after failure: Yes” and “Clean Green: No.”

**Interaction and motion:** Selecting an event reveals its evidence. The connecting line draws once on entry; the final verdict appears with the last event. Provide replay and a complete static state. Use the existing demo-pr-4 analyzer fixture.

**Value:** Demonstrates fieldnote's distinctive evidence. A changed test is a reason to inspect the change, not automatic proof that an agent cheated or weakened it.

### 4. Progress — a compact payoff

**Headline:** “A grade you can trace to a commit.”

**Copy:** “Inspect the checks behind your card, make a change, and grade again.”

**Layout:** Return to the light background. Show two example grade cards with the specific readiness change between them. Reduce the six-tier catalogue to a compact supporting strip below, with details available on selection.

**Motion:** A brief transition between the example cards, then rest. Avoid another continuously running score climb competing with the hero.

**Value:** Connects the desirable card to earned, inspectable progress. Keep readiness separate from delivery outcomes: the page must not claim a higher score caused fewer CI attempts.

### 5. Trust — compact and inspectable

**Headline:** “Inspect the evidence behind the number.”

**Layout:** One annotated evidence panel paired with three short statements: deterministic scoring; versioned rubric; unknown remains unknown. Put detailed metric definitions in an expandable reference below rather than making a large table a main narrative section.

Explain “no LLM judges” specifically as a scoring property; do not extend it to authoring. Keep implementation details such as metric storage behavior out of the main pitch.

### 6. Conversion — a concrete next step

**Headline:** “Find your repository's next improvement.”

**Copy:** “Connect a repository to inspect its readiness checks and pull-request history.”

**Primary CTA:** “Connect with GitHub” using the existing authentication entry point.

**Secondary CTA:** “Explore the example” scrolls back to the on-page walkthrough. This provides a useful preview without implying a hosted public demo exists.

Show the next steps plainly: sign in → select a repository → review the evidence after import. Avoid unverified timing promises. Keep self-hosting and source links nearby but visually secondary.

## Visual and motion direction

Preserve the hero's typography, foil treatment, and palette. Introduce rhythm through composition: editorial split → large demonstration → dark timeline → airy progress moment → evidence detail → clear invitation.

Use larger focal objects and more deliberate whitespace, rather than adding more decorative cards. Extend the shared design tokens where needed. The dark band should have comfortably readable text and visible keyboard focus.

Motion should explain a transition: a question locates an artifact, a change satisfies a check, revisions lead to a verdict. Prefer short, one-time transitions around 200–450 ms and user-controlled demonstrations. No scroll locking. Under reduced motion, show the selected or completed state instantly. Content must remain available with JavaScript disabled. Mobile must not require hovering or horizontal scrolling.

## Product accuracy to resolve before final copy

The README and landing page describe authored pull requests as future work, while the repository contains authoring runs and permission-dependent availability. Verify the deployed capability before making automated PR creation part of the demonstration. The proposal works with a user-made change in the meantime.

Keep Train/MCP out of the main value sequence while it is presented as planned. If retained, place it in a clearly labelled roadmap note.

## Scope and review criteria

Proposed scope: the public landing page's composition and marketing components after the hero. No changes to grading logic, dashboard behavior, or onboarding are needed for this concept.

Before implementation, approve the narrative and the main demonstration. During implementation, validate desktop and mobile layouts, keyboard operation, reduced motion, no-JavaScript content, and fixture-derived claims. Check that the preserved hero has not changed.

Audience validation: show the proposal to a few target users and ask them to explain what fieldnote helps them do, what they would improve first, and what they expect after connecting GitHub. If they recall only the grade, strengthen the action example. Conversion impact remains a hypothesis until measured; repository connection and reaching a first grade are more meaningful signals than animation engagement alone.

## Review decision

Does direction A—an improvement walkthrough, followed by the PR evidence demonstration—capture the value you want people to associate with fieldnote?
