# Code Swipe

Quick code-review practice, swipe style. Spot bugs, learn from explanations, and build up your skills as the questions get harder. Gemini makes new challenges; Firebase keeps your progress in sync.

To run locally, use Node 22+, run `npm ci`, copy `.env.example` to `.env`, add your Gemini API key, then run `npm run dev`. Open `http://localhost:3000`.

Google sign-in and saved progress need a Firebase project: update `firebase-applet-config.json`, enable Google sign-in, authorize your app's domain, and deploy `firestore.rules` to the configured Firestore database. Built-in practice cards cover Python, JavaScript, Rust, and C++ when AI is unavailable.

`npm run lint` checks types. `npm test` builds and runs regression checks. For a production build, run `npm run build` and `npm start`.

Created with Google App Studio
