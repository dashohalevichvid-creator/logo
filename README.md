# Logogram Connect

Logogram is a realtime messaging app with an original brand and visual language.

## Run locally

Install dependencies once, then start the HTTP and WebSocket server:

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows and sign into different accounts to test live messaging.

## Publish a permanent link

The repository includes `render.yaml` for deployment to Render:

1. Create a GitHub repository and upload this project.
2. In Render, choose **New +** -> **Blueprint** and select the GitHub repository.
3. Deploy the detected `render.yaml` service.
4. Share the generated `https://...onrender.com` address. Both users must use that same address.

The free Render service may sleep after inactivity and wake on the next visit. The current development server stores users and messages in memory, so a restart clears messages and newly registered accounts. A permanent production messenger needs a database and secure secret management.

## Demo access

Use any of these accounts:

- `test1` / `SPIDER200` (administrator)
- `admin` / `SPIDER500`

Additional demo contacts are available from the search field. New accounts can be created from the sign-up view.

## Included in the prototype

- Server-backed login for development accounts
- Unique `@username` search
- One-to-one chat views with live WebSocket delivery
- WebRTC audio calls with incoming call, accept, reject, and hangup controls
- Server-side in-memory message history while the server is running
- Unread counters, timestamps, typing feedback, presence updates, and toast notifications
- Text, emoji, image, and file attachment messages
- Profile editing, online/offline presence labels, and clear conversation action
- Light and dark themes
- Responsive desktop, tablet, and mobile layouts

## Production boundary

The included server is a development backend. It keeps data in memory, uses demo passwords, and is not yet suitable for production. To publish it on the internet, deploy the Node server to a host with a public HTTPS/WSS address. For production, add hashed credentials, session or token management, authorization checks, durable database storage, object storage for uploads, rate limits, and server-side validation. The seeded credentials are for development/demo use only.

Audio calls require microphone permission and a secure browser context. `http://localhost:3000` works for local testing; a public deployment must use HTTPS so browsers allow microphone access.
