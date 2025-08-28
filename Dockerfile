# Stage 1: Build the TypeScript application
FROM node:22 AS build

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json for dependency installation
# Using a lock file is a best practice for reproducible builds
COPY package*.json ./

# Install all dependencies, including devDependencies for building
RUN npm install

# Copy the rest of the source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# --- #

# Stage 2: Create the final production image
FROM node:22

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the compiled JavaScript output from the build stage
COPY --from=build /usr/src/app/dist ./dist

# Define the command to run the application
CMD [ "node", "dist/bot.js" ]
