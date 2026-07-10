# Build stage: Cache dependencies first, then package the application
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app

# Copy pom.xml to download dependencies offline
COPY backend/pom.xml .

# Download dependencies (cached layer)
RUN mvn dependency:go-offline -B

# Copy src and build the package
COPY backend/src ./src
RUN mvn clean package -DskipTests

# Run stage: Use a lightweight JRE image for final execution
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app

# Copy the built jar as app.jar
COPY --from=build /app/target/upi-offline-mesh-0.0.1-SNAPSHOT.jar app.jar

# Expose port 8080
EXPOSE 8080

# Execute the application
ENTRYPOINT ["java", "-jar", "app.jar"]
