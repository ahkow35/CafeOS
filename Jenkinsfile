pipeline {
    agent any
    
    environment {
        NEXT_PUBLIC_SUPABASE_URL = credentials('cafeos-supabase-url')
        NEXT_PUBLIC_SUPABASE_ANON_KEY = credentials('cafeos-supabase-anon-key')
        NODE_VERSION = '18'
    }
    
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        
        stage('Install Dependencies') {
            steps {
                sh '''
                    node --version
                    npm --version
                    npm ci
                '''
            }
        }
        
        stage('Build') {
            steps {
                sh '''
                    echo "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" > .env.local
                    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}" >> .env.local
                    
                    # Build standalone app
                    npm run build
                    
                    # Copy public and static assets to standalone folder
                    cp -r public .next/standalone/public
                    cp -r .next/static .next/standalone/.next/static
                '''
            }
        }
        
        stage('Deploy') {
            steps {
                sh '''
                    # Stop existing process if running
                    pkill -f "server.js" || true
                    
                    # Start the standalone server
                    cd .next/standalone
                    nohup node server.js > /var/log/cafeos/app.log 2>&1 &
                    
                    # Wait for server to start
                    sleep 5
                    
                    # Health check
                    curl -f http://localhost:3000 || exit 1
                '''
            }
        }
    }
    
    post {
        success {
            echo 'Deployment successful! CafeOS is now running.'
            // Archive the standalone build for troubleshooting if needed
            archiveArtifacts artifacts: '.next/standalone/**, .next/static/**', allowEmptyArchive: true
        }
        failure {
            echo 'Deployment failed. Check logs for details.'
        }
        cleanup {
            sh 'rm -f .env.local'
        }
    }
}
