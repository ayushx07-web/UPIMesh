# Stage 1: Build the React frontend
FROM node:18-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Spring Boot backend
FROM maven:3.9-eclipse-temurin-17 AS backend-build
WORKDIR /backend
COPY backend/pom.xml ./
RUN mvn dependency:go-offline -B
COPY backend/src ./src

# Copy the built frontend static assets into Spring Boot's static resources directory
COPY --from=frontend-build /frontend/dist/ ./src/main/resources/static/

RUN mvn clean package -DskipTests

# Stage 3: Run the application
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=backend-build /backend/target/upi-offline-mesh-0.0.1-SNAPSHOT.jar app.jar

# Port is exposed dynamically based on environment configuration, defaulting to 8080
EXPOSE 8080

# Execute the application
ENTRYPOINT ["java", "-jar", "app.jar"]
