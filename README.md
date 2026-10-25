# Code Swipe

Learn to read code and identify if it was implemented correctly or not. Over time problems become harder and attempt to match appropriate to your level of knowledge. 

This was a small project I made to explore this as an alternative idea for testing coding knowledge based on the ideas from [Using Erroneous Examples to Improve Mathematics Learning with a Web-Based Tutoring System (Adams et al., 2014).](https://www.cs.cmu.edu/~bmclaren/pubs/AdamsEtAl-UsingErrExToImproveMathLearningWithWebTutoringSys-CHB2014.pdf)

It worked pretty well, but I don't like the elo system. It's not a good fit for this kind of system. There's been a lot of research into different student problem matching systems and elo is widely regarded as insufficient even for well defined concepts. 

But student problem matching is still an area of active research, and there is no proven "best" way to do it, especially when you lack data or are bootstrapping a new system like `code-swipe`.

Furthermore, it doesn't appropriately account for languages' surrounding ecosystem. There's more to python, javascript, java and rust than what comes with the language, but the system doesn't have a good way of gradually introducing those concepts over time yet. 

A better version might allow students to provide areas of interest and gradually introduce related dependencies over time, like `pandas`, `numpy`, `cuda`, etc, if they are introduced in machine learning, as an example.

There's also a more nebulous question about what it means for a student to have gained what they wanted from the platform. I don't have a great solution for having the platform say "you have learned what you need to learn."

## Demo

![Code Swipe gameplay: swiping code cards and reviewing bug explanations](docs/assets/code-swipe-gameplay.gif)

With Node 22+, run `npm ci` and `npm run dev`, then open `http://localhost:3000`.

Sign-in and saved progress need working Firebase configuration in `firebase-applet-config.json`. Copy `.env.example` to `.env` and add a Gemini key for AI features; built-in practice cards cover a few languages without one.

Created with Google App Studio
