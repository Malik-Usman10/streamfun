# StreamFun - Multi-Cloud Storage Backend

A Node.js backend system that provides unified access to multiple cloud storage providers with automatic authentication, file encryption, chunked uploads for large files, and streaming capabilities.

## Features

- Multi-cloud storage support (Google Drive, Koofr, TeraBox, Filen, Blomp)
- AES-256 file encryption for images and videos
- Chunked upload/download for large files (up to 10 GB)
- Automatic authentication and token management
- Account rotation for bandwidth balancing
- REST API for file operations
- Background workers for maintenance tasks
- Redis caching for streaming links
- Web-based frontend and admin dashboard

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **Cache**: Redis
- **Queue**: BullMQ
- **Testing**: Vitest + fast-check (property-based testing)

## Project Structure

```
src/
├── config/          # Configuration management
├── database/        # Database connections and migrations
├── middleware/      # Express middleware
├── providers/       # Storage provider adapters
├── repositories/    # Data access layer
├── services/        # Business logic
├── workers/         # Background workers
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── index.ts         # Application entry point
```

## Getting Started

### Prerequisites

- Bun installed
- Docker and Docker Compose installed

### Installation

1. Clone the repository

2. Start PostgreSQL and Redis containers:
   ```bash
   sudo docker compose up -d
   ```

3. Copy `.env.example` to `.env` (already configured for Docker):
   ```bash
   cp .env.example .env
   ```

4. Install dependencies:
   ```bash
   bun install
   ```

5. Run database migrations:
   ```bash
   bun run migrate:up
   ```

6. Start the development server:
   ```bash
   bun run dev
   ```

### Docker Management

- Stop containers: `sudo docker compose down`
- View logs: `sudo docker compose logs -f`
- Restart containers: `sudo docker compose restart`
- Remove volumes: `sudo docker compose down -v` (WARNING: deletes all data)

## Environment Variables

See `.env.example` for all configuration options.

## API Documentation

API documentation will be available at `/api/docs` once implemented.

## License

MIT
