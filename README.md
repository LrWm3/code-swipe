# Code Swipe

Read a coding problem, a corresponding solution and swipe left or right to identify if it was implemented correctly or not. 

Over time problems become more difficult, are presented in unusual forms, and attempt to match to your level of demonstrated knowledge. 

## Demo

![Code Swipe gameplay: swiping code cards and reviewing bug explanations](docs/assets/code-swipe-gameplay.gif)

## Background

This was a small project I made to explore this as an alternative idea for testing coding knowledge based on the ideas from [Using Erroneous Examples to Improve Mathematics Learning with a Web-Based Tutoring System (Adams et al., 2014).](https://www.cs.cmu.edu/~bmclaren/pubs/AdamsEtAl-UsingErrExToImproveMathLearningWithWebTutoringSys-CHB2014.pdf)

It extends it slightly by having initial representations of problems as relatively straightforward in how they are defined. Whereas later versions of the same problem are written in a more "adversarial" manner, to test if the learning holds.

It works pretty well, but I don't like the elo system. The elo system is well understood to not be a great student problem matching mechanism: learning tends to be more transitory from not understanding to partial understanding to understanding, which elo does not model very well. 

Elo problem matching systems tend to suffer from difficulty spikes, long periods of problems being too easy or rapidly becoming too hard, and connecting concepts to difficulty. I would say this project reproduces those problems. 

There's plenty o research into different student problem matching systems. As mentioned before, elo is widely regarded as insufficient even for well defined concepts, and I personally regard software training full of vaguely connected concepts for which there is no well established order or cadence for learning outside of the basics.

Student problem matching is still an area of active research, and there is no proven "best" way to do it, especially when you lack data or are bootstrapping a new system like `code-swipe` does. None of the ones I researched seemed like a good fit for this particular model without already operating at scale. 

That said, I think there may be a promising approach in having LLMs which are leaned upon more heavily to define what a concept is, generate questions and directly measure concept mastery, but no version of this is implemented in the project as it exists today.

Furthermore, `code-swipe` does not appropriately account for languages' surrounding ecosystem. There's more to python, javascript, java and rust than what comes with the language, but the system doesn't have a good way of gradually introducing those concepts over time yet. This ties back to the vagueness in definine what a concept is and when it should be introduced.

A better version might allow students to provide areas of interest and gradually introduce related dependencies over time, like `pandas`, `numpy`, `cuda`, etc, if they are introduced in machine learning, as an example. Or perhaps it would surface those subjects autonomously and allow students to indicate their interest at that time.

There's also a more nebulous question about what it means for a student to have gained what they wanted from the platform. I don't have a great solution for having the platform say "you have learned what you need to learn."

Overall the `code-swipe` approach itself shows some promise, but the student problem matching problem prevents it from being effective as it exists today.

## Run it yourself 

With Node 22+, run `npm ci` and `npm run dev`, then open `http://localhost:3000`.

Sign-in and saved progress need working Firebase configuration in `firebase-applet-config.json`. Copy `.env.example` to `.env` and add a Gemini key for AI features; built-in practice cards cover a few languages without one.

Or use AI agents to fork it and run it as an offline only version.

Created with Gemini Canvas and later Google App Studio
