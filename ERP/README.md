# Excledge ERP - Inventory Management System

A modern, responsive, and feature-rich Inventory Management System built with React, TypeScript, and Vite. This application provides a comprehensive solution for managing inventory, organizations, and user access control.

## 🚀 Features

- **User Authentication**
  - Secure login and registration
  - Email verification
  - Password reset functionality
  - Role-based access control

- **Dashboard**
  - Real-time statistics and metrics
  - Quick overview of key performance indicators
  - Recent activity tracking

- **Inventory Management**
  - Product catalog management
  - Stock level monitoring
  - Barcode/QR code support

- **Organization Management**
  - Multi-tenant architecture
  - User role management
  - Subscription plans

## 🛠 Tech Stack

- **Frontend**
  - React 19 with TypeScript
  - Vite for fast development and building
  - Tailwind CSS for styling
  - Radix UI for accessible components
  - React Hook Form for form handling
  - React Query for data fetching and caching
  - React Router for navigation

- **Backend**
  - Node.js with Express
  - Prisma ORM
  - PostgreSQL database
  - JWT for authentication

## 📦 Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL

## 🚀 Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/niyobertin/inventory-system.git
   cd inventory-system
   ```

2. **Install dependencies**
   ```bash
   # Install frontend dependencies
   cd inventory-system-fn
   npm install
   
   # Install backend dependencies
   cd ../server
   npm install
   ```

3. **Set up environment variables**
   - Create `.env` files in both `inventory-system-fn` and `server` directories
   - Refer to `.env.example` for required variables

4. **Database Setup**
   - Make sure PostgreSQL is running
   - Run database migrations
   ```bash
   cd server
   npx prisma migrate dev
   ```

5. **Start the development servers**
   ```bash
   # In the server directory
   npm run dev
   
   # In a new terminal, in the frontend directory
   cd ../inventory-system-fn
   npm run dev
   ```

6. **Open in browser**
   - Frontend: http://localhost:5173
   - API: http://localhost:port

## 🧪 Testing

Run the test suite:
```bash
# Frontend tests
npm test

# Backend tests
cd server
npm test
```

## 🏗 Build for Production

```bash
# Build frontend
cd inventory-system-fn
npm run build

# Build and start backend
cd ../server
npm run build
npm start
```

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Contact

For any inquiries or support, please contact [niyonkurubertin@gmail.com](mailto:niyonkurubertin@gmail.com)
