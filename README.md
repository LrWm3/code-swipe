# Code Swipe

Train your code review skills by reviewing code.

Read a coding problem and a code snippet that attempts to solve it, then swipe left or right to decide whether the solution meets the specification. Review incorrect answers, see what you missed, examine adversarially prepared problems, and improve over time.

Over time, problems become more difficult and appear in unusual forms. The system tries to match them to your demonstrated knowledge so you can keep learning without having to select each concept to master.

## Demo

![Code Swipe gameplay: swiping code cards and reviewing bug explanations](docs/assets/code-swipe-gameplay.gif)

## Background

This was a small project I made to explore an alternative way to test coding knowledge, inspired by [Using Erroneous Examples to Improve Mathematics Learning with a Web-Based Tutoring System (Adams et al., 2014)](https://www.cs.cmu.edu/~bmclaren/pubs/AdamsEtAl-UsingErrExToImproveMathLearningWithWebTutoringSys-CHB2014.pdf).

The project extends that idea slightly. Initial versions of problems are relatively straightforward. Later versions of the same problem use different programming styles, including imperative, functional, stream-based, and object-oriented approaches, to test whether the learning holds when the shape changes. Later problems also mix concepts to test the reader's ability to identify which part, if any, contains an error.

Eventually, problems appear in an adversarial form, requiring careful reading of code you would rarely see in ordinary projects. This is intended to strengthen review skills beyond what a typical job would require.

This core approach appears to work quite well in my own testing; I haven't performed any controlled studies. In particular, different representations of essentially the same problem seemed to help me learn the underlying rule instead of just recognizing the shape of the problem. Adversarially prepared problems also seemed to broaden my sense of the problems I might encounter, which felt useful.

A weaker area is the Elo system. Learning involves moving from not understanding a concept to partially understanding it to understanding it well. Elo does not capture that progression well.

Elo-based problem matching tends to produce difficulty spikes, long stretches of problems that are too easy, or problems that become too hard too quickly. It also struggles to connect individual concepts to difficulty. I would say this project reproduces those problems.

Unfortunately, while the system seems good at reinforcing individual concepts through a few different problem formulations, it struggles to present the right problems at the right time. That limits how effective I find it in its current form.

Code Swipe also doesn't adequately account for the ecosystems surrounding programming languages. There's more to Python, JavaScript, Java, and Rust than what comes with the language, but the system doesn't yet have a good way to gradually introduce those broader concepts. What counts as a concept in programming, and when it should be introduced, seems less clearly defined than in well-established fields such as reading and mathematics.

A better version might let students specify their interests and gradually introduce related libraries and tools. For someone interested in machine learning, for example, those might include `pandas`, `numpy`, `trt`, `torch`, and `onnx`. Or perhaps the system could introduce those subjects on its own and let students indicate their interest then.

I also like having a defined session length, though ten problems a day seems arbitrary. More advanced platforms try to design sessions up front to balance engagement, desirable difficulty, and mental exhaustion. I think there's room for improvement here, but I'm happy this initial version includes some form of session limit.

There's also a more nebulous question: how do we know when a student has gained what they wanted from the system? I don't have a great way for Code Swipe to say, "You've learned what you came here to learn." Stickiness is a non-goal.

Overall, the Code Swipe approach shows some promise, but its difficulty matching students with appropriate problems keeps it from being effective in its current form. It reproduces many of the findings discussed in [Applications of the Elo rating system in adaptive educational systems (Pelánek, 2016, Computers & Education)](https://doi.org/10.1016/j.compedu.2016.03.017).

For future work, I'd recommend exploring how to categorize and organize concepts, determine student preferences, measure mastery, introduce appropriate problems over time, personalize learning sessions, and decide when learning is complete. Measuring mastery and deciding which concepts to introduce next would interest me most, but I think all these areas need another look to make Code Swipe a helpful educational tool.

## Run it yourself

With Node 22+, run `npm ci` and `npm run dev`, then open `http://localhost:3000`.

Sign-in and saved progress need a working Firebase configuration in `firebase-applet-config.json`. Copy `.env.example` to `.env` and add a Gemini key for AI features; built-in practice cards cover a few languages without one.

Or use AI agents to fork it and create an offline-only version.

Created with Gemini Canvas and later Google App Studio
