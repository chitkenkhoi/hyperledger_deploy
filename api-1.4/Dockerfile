# Use the official Node.js image
FROM node:10

# Create and change to the app directory
WORKDIR /usr/src/app/api-1.4

# Copy package.json and package-lock.json files
COPY package*.json ./
#Check npm and node version
RUN npm -v
RUN node -v
# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
CMD ["node", "app.js"]
