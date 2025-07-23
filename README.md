# Photocopy Optimizer

An automated system for managing photocopy jobs via WhatsApp, featuring intelligent job queuing, batching, and printing. This system streamlines the process of handling print requests through WhatsApp, making it efficient and user-friendly for both customers and operators.

## Features

- **WhatsApp Integration**
  - Receive documents and instructions via WhatsApp
  - Robust QR code authentication with 60-second timeout
  - Real-time status updates and notifications
  - Multi-user support with business account
  - Automatic reconnection and error recovery

- **Smart Processing**
  - Intelligent instruction parsing for print requirements
  - Support for multiple file types (PDF, images, documents)
  - Natural language processing for print instructions
  - Automatic document format detection

- **Queue Management**
  - Intelligent job queuing and batching
  - Priority-based scheduling (urgent, high, normal, low)
  - Real-time queue status monitoring
  - Automatic job optimization and error handling
  - Job retry and cancellation capabilities

- **Printing System**
  - Automated printing via Windows print system
  - Support for multiple printers and paper types
  - Print job tracking and management
  - Error handling and recovery
  - Progress monitoring and status updates

- **Web Dashboard**
  - Real-time monitoring of print queue
  - WhatsApp connection status
  - Printer status and management
  - Document history and job tracking
  - Interactive job management (cancel, retry)

## Prerequisites

- Node.js (v14 or higher)
- Windows operating system (for printer integration)
- WhatsApp Business account
- Sufficient storage for temporary files
- Network access for WhatsApp connection

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/photocopy-optimizer.git
   cd photocopy-optimizer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```env
   PORT=3002
   LOG_LEVEL=info
   ```

4. Start the application:
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

5. Open the web dashboard at `http://localhost:3002`

6. Click "Connect" to start WhatsApp authentication and scan the QR code

## Usage

### For Customers (WhatsApp)

1. **Send a document** to the WhatsApp number
2. **Reply with instructions** like:
   - "2 copies"
   - "Color pages 1-3"
   - "A3 paper, urgent"
   - "3 copies, glossy paper"
   - "Print" (for default settings)

3. **Receive confirmation** when your job is queued
4. **Get notified** when printing is complete

### For Operators (Web Dashboard)

1. **Monitor the queue** in real-time
2. **View job details** and progress
3. **Manage jobs** (cancel, retry, prioritize)
4. **Check printer status** and connection
5. **View document history**

## Project Structure

```
src/
├── index.js                # Main application entry
├── events/                 # Event management
│   └── eventManager.js     # Event manager logic
├── parser/                 # Instruction parsing
│   └── instructionParser.js# Natural language instruction parser
├── print/                  # Print queue logic
│   └── queue.js            # Print queue implementation
├── printer/                # Printer integration
│   ├── maintenance.js      # Printer maintenance logic
│   └── printerManager.js   # Windows printer management
├── queue/                  # Job queue management
│   ├── jobBatcher.js       # Job batching logic
│   └── printQueue.js       # Print queue logic
├── server/                 # Server setup
│   └── index.js            # Express HTTP server
├── storage/                # Document storage management
│   └── documentManager.js  # Document storage and retrieval
├── websocket/              # WebSocket server
│   └── server.js           # Real-time communication
├── whatsapp/               # WhatsApp integration
│   └── client.js           # WhatsApp client with robust authentication
```

Other folders:
- `public/` - Web dashboard (HTML, CSS, JS)
- `data/` - Persistent data (queue.json)
- `logs/` - Application logs
- `storage/documents/` - Uploaded/processed documents
- `whatsapp_auth/` - WhatsApp session/auth files

## Development Status

Currently in Phase 2: Core Features Implementation

### ✅ Completed
- [x] Project setup and configuration
- [x] Basic project structure
- [x] Development environment setup
- [x] WhatsApp integration with robust authentication
- [x] QR code management with timeout and regeneration
- [x] Natural language instruction parsing
- [x] Document storage and management
- [x] Print queue implementation
- [x] Windows printer integration
- [x] Web dashboard with real-time updates
- [x] Error handling and recovery
- [x] File naming preservation (original names)
- [x] Paper type validation and support
- [x] Job priority and scheduling
- [x] Real-time status monitoring

### 🔄 In Progress
- [ ] Document download from WhatsApp media
- [ ] Advanced job batching optimization
- [ ] Multi-printer support
- [ ] Print job analytics

### 📋 Planned Features
- [ ] User authentication and roles
- [ ] Mobile app integration
- [ ] Advanced analytics dashboard
- [ ] Email notifications
- [ ] Payment integration
- [ ] Multi-language support
- [ ] Cloud storage integration
- [ ] API for third-party integrations

## Technical Details

### WhatsApp Integration
- Uses `@whiskeysockets/baileys` for WhatsApp Web API
- Robust QR code authentication with 60-second timeout
- Automatic reconnection and error recovery
- Multi-file authentication state management

### Print System
- Windows printer integration via `wmic` commands
- Support for multiple paper types (plain, photo, glossy)
- Priority-based job scheduling
- Real-time progress monitoring

### Web Dashboard
- Real-time updates via WebSocket
- Responsive design with Tailwind CSS
- Interactive job management
- Live status monitoring

## Troubleshooting

### QR Code Issues
- QR code disappears quickly: The system now maintains QR visibility for 60 seconds
- Can't scan QR: Use the "Show QR" button to regenerate
- Connection fails: Check network and try reconnecting

### Print Job Issues
- Jobs not appearing: Check WhatsApp connection status
- Print errors: Verify printer is connected and ready
- File name issues: Original file names are now preserved

### General Issues
- Check the logs in the `logs/` directory
- Verify all prerequisites are installed
- Ensure Windows printer system is working

## Acknowledgments

- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp integration
- [Socket.IO](https://socket.io/) for real-time communication
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Express.js](https://expressjs.com/) for web server 