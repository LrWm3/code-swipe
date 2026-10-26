# Code Swipe

Train code review as a skill by reviewing code.

Read a coding problem, a code snippet solving that problem, and swipe left or right to identify if the presented solution correctly implements the problem as specified or not. Review incorrect answers, see what was missed, examine adversarially prepared problems and improve over time. 

Over time problems become more difficult, are presented in unusual forms, and attempt to match to your level of demonstrated knowledge so you can continue to learn as you go without needing to intentionally select concepts to master.

## Demo

![Code Swipe gameplay: swiping code cards and reviewing bug explanations](docs/assets/code-swipe-gameplay.gif)

## Background

This was a small project I made to explore this as an alternative idea for testing coding knowledge based on the ideas from [Using Erroneous Examples to Improve Mathematics Learning with a Web-Based Tutoring System (Adams et al., 2014).](https://www.cs.cmu.edu/~bmclaren/pubs/AdamsEtAl-UsingErrExToImproveMathLearningWithWebTutoringSys-CHB2014.pdf)

It extends it slightly by having initial representations of problems as relatively straightforward in how they are defined. Whereas later versions of the same problem are written in familiar manner, leveraging different programming styles such as imperative, functional, streams-based, object oriented, and more to test if the learning holds when the shape changes. Later problems mix concepts as well, so that a problem tests the readers ability to determine which part was done incorrectly, if there is an error.

Additionally, prblems are are eventually presented in an adversarial form, where comphrension requires carefully reading code that would typically not be seen in normal programming projects. This is intended to strengthen review capacity beyond what would be needed in a typical job setting.

This core function appears to work quite well in my individual testing; no controlled studies were performed. In particular, different representations of essentially the same problem seemed like a strong methodology for avoiding learning only the shape of the problem but not the underlying rule, in my individual testing. And adversarially prepared problems seemed to help expand my conception of what problems I could potentially see in a way which felt beneficial.

A weaker area is the Elo system. Learning tends to be transitory; from not understanding to partial understanding to understanding, which elo does not capture well.

Elo problem matching systems tend to suffer from difficulty spikes, long periods of problems being too easy or rapidly becoming too hard, and connecting concepts to difficulty. I would say this project reproduces those problems. 

Unfortunately, this means that while the system itself seems good at reinforcing individual concepts through a few different problem formulations, it struggles to actually present the right problems at the right time, limiting how effective I perceive it to be in its current form.

Furthermore, `code-swipe` does not appropriately account for languages' surrounding ecosystem. There's more to python, javascript, java and rust than what comes with the language, but the system doesn't have a good way of gradually introducing those concepts over time yet. The vagueness in defining what a concept is in programming and when it should be introduced is less defined than well established fields such as reading and mathematics.

A better version might allow students to provide areas of interest and gradually introduce related dependencies over time, like `pandas`, `numpy`, `trt`, `torch`, `onnx` etc, if they are introduced in machine learning, as an example. Or perhaps it would surface those subjects autonomously and allow students to indicate their interest at that time.

I like the session length as well. 10 a day seems arbitrary. More advanced platforms will try to design a session up front to balance engagement, desirable difficulty, and mental exhaustion. I think there is room for improvement here, but am happy session lengths were present in this initial version in some form.

There's also a more nebulous question about what it means for a student to have gained what they wanted from the system. I don't have a great solution for having `code-swipe` say "you have learned what you came here to learn." Stickiness is a non-goal.

Overall the `code-swipe` approach itself shows some promise, but the student problem matching problem prevents it from being effective as it exists today. It reproduces many of the discoveries made in [​Pelánek, R. (2016). Applications of the Elo rating system in adaptive educational systems. Computers & Education](https://doi.org/10.1016/j.compedu.2016.03.017).

Recommendation for future work to further explore how to categories concepts, organize them meaningfully, determine student preferences, measure mastery, surface problems appropriately over time, personalizing learning sessions and when to consider learning complete. I personally would find measuring mastery and concept surfacing the most interesting to do next, but above are the areas I think would need to be revisited to make `code-swipe` a helpful educational tool.

## Run it yourself 

With Node 22+, run `npm ci` and `npm run dev`, then open `http://localhost:3000`.

Sign-in and saved progress need working Firebase configuration in `firebase-applet-config.json`. Copy `.env.example` to `.env` and add a Gemini key for AI features; built-in practice cards cover a few languages without one.

Or use AI agents to fork it and run it as an offline only version.

Created with Gemini Canvas and later Google App Studio
