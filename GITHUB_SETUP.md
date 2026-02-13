# 🚀 Publishing CafeOS to GitHub

## Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Fill in repository details:
   - **Repository name**: `CafeOS` (or your preferred name)
   - **Description**: "Employee leave management PWA with 2-level approval
     workflow"
   - **Visibility**: Choose **Private** or **Public**
   - ⚠️ **DO NOT** check "Initialize with README" (you already have one)
   - ⚠️ **DO NOT** add .gitignore or license (already exists)
3. Click **Create repository**

## Step 2: Push Your Code

After creating the repository, GitHub will show you instructions. Use these
commands:

```bash
cd /Users/nyanyk/Antigravity/CafeOs

# Add the remote repository
git remote add origin https://github.com/YOUR_USERNAME/CafeOS.git

# Rename branch to main (if needed)
git branch -M main

# Push your code
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username.**

## Step 3: Verify on GitHub

1. Refresh your repository page on GitHub
2. You should see all your files uploaded
3. Verify the README displays correctly

## Step 4: Set Up GitHub for Jenkins (Optional)

If you want Jenkins to automatically deploy when you push code:

1. Go to your repository → **Settings** → **Webhooks**
2. Click **Add webhook**
3. Configure:
   - **Payload URL**: `http://your-jenkins-server/github-webhook/`
   - **Content type**: `application/json`
   - **Events**: Choose "Just the push event"
4. Click **Add webhook**

## Step 5: Configure Jenkins

### Add GitHub Repository to Jenkins

1. Open Jenkins → **New Item**
2. Enter name: `CafeOS-Deploy`
3. Select **Pipeline** → Click **OK**
4. Under **Pipeline** section:
   - **Definition**: Pipeline script from SCM
   - **SCM**: Git
   - **Repository URL**: `https://github.com/YOUR_USERNAME/CafeOS.git`
   - **Credentials**: Add your GitHub credentials if private repo
   - **Branch**: `*/main`
   - **Script Path**: `Jenkinsfile`
5. Click **Save**

### Add Supabase Credentials to Jenkins

1. Go to **Manage Jenkins** → **Credentials** → **System** → **Global
   credentials**
2. Click **Add Credentials**
3. Add **first credential**:
   - **Kind**: Secret text
   - **Secret**: `https://vtnzxqbakyhomzrudbgu.supabase.co`
   - **ID**: `cafeos-supabase-url`
   - **Description**: CafeOS Supabase URL
   - Click **Create**
4. Click **Add Credentials** again for **second credential**:
   - **Kind**: Secret text
   - **Secret**: `sb_publishable_HrYYWWBE2IvTM42Fr7Kx4w_gtwDkUWt`
   - **ID**: `cafeos-supabase-anon-key`
   - **Description**: CafeOS Supabase Anon Key
   - Click **Create**

## Step 6: Deploy

1. Go to your Jenkins job → Click **Build Now**
2. Watch the build progress in **Console Output**
3. Once complete, your app will be running!

## 🔒 Security Reminder

✅ **Safe to Commit** (Already in repository):

- All source code files
- `Jenkinsfile`
- `README.md`, `DEPLOYMENT.md`
- `.env.local.example` (template only)
- Migration SQL files

❌ **Never Commit** (Protected by `.gitignore`):

- `.env.local` (contains actual credentials)
- `node_modules/`
- `.next/`
- Build artifacts

## 📚 Next Steps

After deploying:

1. **Test the deployment**: Visit `http://your-jenkins-server:3000`
2. **Deploy Supabase Edge Function**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md)
   email notifications section
3. **Set up monitoring**: Configure Jenkins build notifications
4. **Create staging environment**: Use separate Supabase project for testing

## 🆘 Troubleshooting

### "Permission denied" when pushing

```bash
# Use HTTPS with personal access token instead
git remote set-url origin https://YOUR_TOKEN@github.com/YOUR_USERNAME/CafeOS.git
```

### Jenkins build fails

- Check **Console Output** for errors
- Verify credentials are set correctly
- Ensure Node.js 18+ is installed on Jenkins server

### Can't access deployed app

- Check Jenkins console for port conflicts
- Verify firewall allows port 3000
- Check `npm start` is running in background

---

**🎉 Congratulations!** Your CafeOS application is now on GitHub and ready for
Jenkins deployment!
