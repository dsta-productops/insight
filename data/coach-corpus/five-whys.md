# Five Whys

## Principle

Repeatedly asking "why" moves the conversation from a surface symptom toward a root cause, in service of a well-grounded problem statement. Participants usually open with the most recent or most visible layer of a problem ("the export button is confusing"). The first answer is rarely the real driver; each "why" peels back one layer of motivation, constraint, or history.

The technique originates from Toyota's production system (Taiichi Ohno) and adapts naturally to user interviews: the researcher is not debugging a machine but tracing a chain of human reasoning and circumstance.

## Method

1. Start from a concrete statement the participant made ("I stopped using the dashboard").
2. Ask why that happened, in neutral phrasing ("What led to that?").
3. Take the answer as the new starting point and probe again.
4. Continue roughly five levels deep — the number is a heuristic, not a rule. Stop when answers become circular, speculative, or reach factors outside the participant's knowledge.
5. Capture the chain: symptom → contributing causes → root cause candidate.

## Good practice

- Vary the phrasing; a literal chain of "why? why? why?" feels interrogative and can make participants defensive. Alternatives: "What was going on that made that the case?", "Help me understand what was behind that."
- Follow the participant's causal chain, not the researcher's hypothesis. If the answer branches, pick one branch and note the other for later.
- Root causes in user research are often process, incentive, or trust issues — not the UI element the conversation started from.

## Detection patterns (when a coach should suggest this)

- Participant states a problem or complaint and the researcher moves on to a new topic without a single probe.
- Participant gives a symptom-level answer ("it's too slow", "it's confusing") that has not been unpacked.
- The researcher has asked "why" once, received a shallow answer ("it's just easier"), and accepted it.
- Repeated mentions of a workaround without exploration of what makes the workaround necessary.

## Example

- Participant: "I keep a spreadsheet on the side."
- Why? — "The system's numbers are stale."
- Why are they stale? — "The sync only runs overnight."
- Why does that matter for you? — "My report goes out at 3 pm."
- Why is 3 pm the deadline? — "That's when the ops review meets."
- Root-cause candidate: the reporting cycle and sync schedule are misaligned; the spreadsheet is a coping mechanism, not the problem.

## Coaching note

Suggest a specific next "why" grounded in the participant's last utterance, and include the rationale: probing one level deeper converts a symptom into a testable problem statement.
