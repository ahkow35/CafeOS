// Jenkinsfile for CafeOS - HTTPS Registry and Portainer Stack API Deployment
// Configuration variables for easy reusability
def imageName = "cafeos"
def stackId = "REPLACE_WITH_STACK_ID" // TODO: Update this with your actual Portainer Stack ID
def endpointId = "3"
def portainerUrl = "https://portainer.fukie.io"
def portainerTokenName = "portainer-api-key-admin"

pipeline {
    agent {
        docker {
            image 'docker:latest'
            // Fix: Override entrypoint to allow Jenkins to start the container, and mount docker socket
            args '--entrypoint="" --volume /var/run/docker.sock:/var/run/docker.sock'
        }
    }

    environment {
        // Build arguments
        NEXT_PUBLIC_SUPABASE_URL = credentials('cafeos-supabase-url')
        NEXT_PUBLIC_SUPABASE_ANON_KEY = credentials('cafeos-supabase-anon-key')
        IMAGE_NAME = "registry.fukie.io/${imageName}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                echo "Code checked out."
            }
        }

        stage('Build and Push to Secure Registry') {
            steps {
                script {
                    echo "Building image..."
                    // use short git commit SHA as image tag so image <-> commit mapping is obvious
                    def commitId = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    echo "Using commit id ${commitId} for image tag"
                    def imageTag = "${IMAGE_NAME}:${commitId}"
                    def imageLatest = "${IMAGE_NAME}:latest"

                    // Build with build args for environment variables that need to be baked in
                    docker.build(imageTag, "--build-arg NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} .")
                    
                    // Tag latest
                    sh "docker tag ${imageTag} ${imageLatest}"
                    
                    echo "Successfully built image."

                    echo "Pushing image to secure registry..."
                    // Removed withRegistry block to match reference implementation
                    // Assuming node has permissions or config to push to registry.fukie.io
                    docker.image(imageTag).push()
                    docker.image(imageLatest).push()

                    echo "Successfully pushed image."
                }
            }
        }

        // THE FINAL, CORRECT DEPLOY STAGE FOR PORTAINER CE
        stage('Deploy Stack via Portainer API') {
            environment {
                PORTAINER_API_KEY = credentials("${portainerTokenName}")
                PORTAINER_URL = "${portainerUrl}"
                STACK_ID = "${stackId}"
                ENDPOINT_ID = "${endpointId}"
                COMPOSE_FILE_PATH = "docker-compose.yml" // Path to the compose file
            }
            steps {
                sh 'apk add --no-cache curl jq'

                script {
                    echo "Reading compose file content..."
                    // **THE FIX**: Read the docker-compose.yml file from the workspace into a variable.
                    def composeFileContent = readFile(COMPOSE_FILE_PATH)

                    // Build the JSON payload and write to a file so we don't interpolate secrets into the shell command
                    def payload = groovy.json.JsonOutput.toJson([pullImage: true, stackFileContent: composeFileContent])
                    writeFile file: 'portainer_payload.json', text: payload

                    echo "Updating stack via Portainer API..."

                    // Use a non-interpolating shell string so Groovy doesn't expand credential variables.
                    // The shell will read the credential from the environment variable at runtime.
                    sh '''
                    curl -L -X PUT "$PORTAINER_URL/api/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" \
                    -H "X-API-Key: $PORTAINER_API_KEY" \
                    -H "Content-Type: application/json" \
                    --data-binary @portainer_payload.json
                    '''

                    echo "Portainer stack update triggered via API!"
                }
            }
        }
    }

    post {
        always {
            echo "Pipeline finished."
            cleanWs()
        }
    }
}
