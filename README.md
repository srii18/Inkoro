# Photocopy Optimizer

Photocopy Optimizer is a Node.js application for managing photocopy and print jobs via WhatsApp, with intelligent job queuing, batching, and a real-time web dashboard for operators.

## Features
- **WhatsApp Integration:** Users can send documents/images and print instructions via WhatsApp. QR code authentication is required for initial login. If the QR code times out (after 60 seconds), a new QR code is generated automatically and displayed until authentication is successful.
- **Job Queuing and Batching:** Powered by Bull MQ and Redis, jobs are intelligently queued, batched, and prioritized based on user instructions (e.g., urgent, color, copies).
- **PDF and Image Processing:** Supports PDF and common image formats. Users can specify print options (copies, color, paper size, etc.).
- **Printer Management:** Supports multiple printers. Printers are configured via a config file or environment variables and discovered automatically or manually as per the configuration.
- **Web Dashboard:** Real-time dashboard for operators to monitor, accept, and manage print jobs. Features include:
  - Live queue and job status updates
  - Accept/cancel jobs
  - Preview PDFs/images before printing
  - Group images for batch printing
  - View printer status

## .env Variables
List all required environment variables in your `.env` file:
```
PORT=3002
NODE_ENV=development
WHATSAPP_API_KEY=your_whatsapp_api_key
REDIS_URL=redis://localhost:6379
PRINTER_CONFIG_PATH=./config/printers.json
```

## Technologies Used
- Node.js
- Express
- Bull MQ (with Redis)
- Socket.IO
- Baileys (WhatsApp integration)
- Pino (logging)
- node-printer
- pdf-parse
- React (for dashboard)

## Project Structure
```
/ (root)
  |-- src/
      |-- events/           # Event management
      |-- parser/           # Instruction parsing
      |-- print/            # Print queue logic
      |-- printer/          # Printer management
      |-- queue/            # Job batching/queueing
      |-- server/           # Express server
      |-- storage/          # Document/image storage
      |-- websocket/        # WebSocket server
      |-- whatsapp/         # WhatsApp integration
  |-- public/               # Dashboard frontend
  |-- storage/              # Uploaded/processed files
  |-- logs/                 # Log files
  |-- data/                 # Queue/job data
  |-- .env                  # Environment variables
```

## Testing
- (Add instructions for running tests here. If not implemented, add a placeholder:)
- _Testing not yet implemented. To add tests, use Jest or Mocha for backend and React Testing Library for frontend._

## License
- _MIT License recommended. Add a LICENSE file to the project._

## Contributing Guidelines
- _Add a CONTRIBUTING.md file or section with guidelines for code style, pull requests, and issue reporting._

## Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Set up your `.env` file (see above)
4. Start Redis server (required for Bull MQ)
5. Start the application: `npm start` (or `npm run dev` for development)

## Usage
- **For Customers (WhatsApp):**
  - Send a document or image to the WhatsApp number.
  - Reply with print instructions (e.g., "2 copies", "Color pages 1-3").
  - Receive queue status, ETA, and job updates via WhatsApp.
- **For Operators (Web Dashboard):**
  - Monitor and manage jobs in real time.
  - Accept/cancel jobs, preview documents, and view printer status. 