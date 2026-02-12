# CafeOS 🏢

A modern, Progressive Web App (PWA) for employee leave management with a 2-level
approval workflow.

## ✨ Features

- 📱 **Progressive Web App** - Install on any device, works offline
- 🔐 **Secure Authentication** - Powered by Supabase Auth
- 👥 **Role-Based Access Control** - Staff, Manager, and Owner roles
- ✅ **2-Level Approval Workflow** - Manager review → Owner final approval
- 📊 **Leave Balance Tracking** - Annual and medical leave entitlements
- 📄 **Medical Certificate Upload** - Support for medical leave documentation
- 📧 **Email Notifications** - Automatic status updates via Resend
- 📱 **Mobile-First Design** - Responsive UI for all screen sizes
- 📂 **Leave History Archive** - Track and filter past leave applications

## 🏗️ Architecture

### Tech Stack

- **Frontend**: Next.js 15 (App Router), React, TypeScript
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Styling**: Tailwind CSS
- **Email**: Resend API
- **Deployment**: Jenkins CI/CD

### Database

CafeOS uses **Supabase** as a cloud-hosted database. The schema includes:

- `profiles` - User profiles with roles (staff/manager/owner)
- `leave_applications` - Leave requests with approval statuses
- `leave_entitlements` - Annual leave balances per user
- `medical_certificates` - File metadata for medical evidence

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account
- Resend account (for email notifications)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/CafeOs.git
   cd CafeOs
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   ```

   Edit `.env.local` and add your Supabase credentials:
   - Get them from [supabase.com/dashboard](https://supabase.com/dashboard) →
     Your Project → Settings → API

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open the app**
   - Navigate to [http://localhost:3000](http://localhost:3000)

## 🗄️ Database Setup

The database migrations are in `supabase/migrations/`. To set up your Supabase
database:

1. Create a new Supabase project
2. Run migrations in order via Supabase SQL Editor, or use the Supabase CLI:
   ```bash
   npx supabase db push
   ```

## 📧 Email Notifications Setup

See [EMAIL_NOTIFICATIONS_SETUP.md](./EMAIL_NOTIFICATIONS_SETUP.md) for detailed
instructions on configuring the Resend integration and deploying the Edge
Function.

## 🚢 Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment instructions
including:

- Jenkins CI/CD pipeline setup
- Environment variable configuration
- Supabase Edge Function deployment
- Troubleshooting guide

## 📚 Project Structure

```
CafeOs/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   ├── admin/        # Admin dashboard pages
│   │   ├── leave/        # Leave application pages
│   │   └── profile/      # User profile pages
│   ├── components/       # Reusable React components
│   ├── lib/              # Utility functions and Supabase client
│   └── types/            # TypeScript type definitions
├── supabase/
│   ├── functions/        # Edge Functions (email notifications)
│   └── migrations/       # Database schema migrations
├── public/               # Static assets and PWA manifest
└── Jenkinsfile          # CI/CD pipeline configuration
```

## 🔒 Security

- Row Level Security (RLS) policies enforce data access control
- Supabase Auth handles authentication
- Environment variables keep credentials secure
- File uploads are validated and stored securely in Supabase Storage

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📝 License

This project is private/proprietary. Contact the owner for licensing
information.

## 🆘 Support

For deployment or technical issues, see [DEPLOYMENT.md](./DEPLOYMENT.md)
troubleshooting section.
