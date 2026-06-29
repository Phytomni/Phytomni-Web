FROM golang:1.22-alpine

COPY ./config /app/config/
WORKDIR /app

# Copy the binary built outside this Dockerfile (no in-image go build step)
COPY main .

RUN chmod +x main

EXPOSE 8080

CMD ["./main"]