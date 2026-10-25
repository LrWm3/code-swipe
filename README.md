# Code Swipe

Learn to read code and identify if it was implemented correctly or not.

This was a small project I made to explore this as an alternative idea for testing coding knowledge based on the ideas from [Using Erroneous Examples to Improve Mathematics Learning with a Web-Based Tutoring System (Adams et al., 2014).](https://www.cs.cmu.edu/~bmclaren/pubs/AdamsEtAl-UsingErrExToImproveMathLearningWithWebTutoringSys-CHB2014.pdf)

It worked pretty well, but I don't like the elo system. It's not a good fit for this kind of system. There's been a lot of research into different student problem matching systems but its still an area of active research.

![Code Swipe gameplay: swiping code cards and reviewing bug explanations](docs/assets/code-swipe-gameplay.gif)

With Node 22+, run `npm ci` and `npm run dev`, then open `http://localhost:3000`.

Sign-in and saved progress need working Firebase configuration in `firebase-applet-config.json`. Copy `.env.example` to `.env` and add a Gemini key for AI features; built-in practice cards cover a few languages without one.

Created with Google App Studio
