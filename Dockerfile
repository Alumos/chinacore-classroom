# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY main.go main_test.go ./
COPY --from=frontend /build/web/dist ./web/dist
RUN CGO_ENABLED=0 go test ./... && go vet ./...
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN mkdir -p /out/app /out/data && chmod 0700 /out/data && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/app/chinacore-classroom .

# One static program includes both the Go API and the production frontend.
FROM scratch AS runtime
COPY --from=backend --chown=10001:10001 /out/ /
USER 10001:10001
WORKDIR /app
ENV PORT=18080 DATA_FILE=/data/classroom.db
EXPOSE 18080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/app/chinacore-classroom", "healthcheck"]
ENTRYPOINT ["/app/chinacore-classroom"]
