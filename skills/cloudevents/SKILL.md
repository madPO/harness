---
name: cloudevents
description: Guide for designing, producing, and consuming CloudEvents (CNCF spec v1.0). Use when the user asks about CloudEvents, event-driven architecture with standardized event envelopes, producing or consuming CloudEvents over HTTP, Kafka, AMQP, or NATS, writing CloudEvents code in Go or C#/.NET, or choosing between structured vs binary content mode. Covers spec attributes, protocol bindings, extension attributes, observability, idempotency, and common anti-patterns.
metadata:
  author: perplexity-computer
  version: '1.0'
  spec_version: '1.0.2'
---

# CloudEvents Skill

## When to Use This Skill

Load when the user asks to:
- Design or review an event schema using the CloudEvents specification
- Produce or consume CloudEvents over HTTP, Kafka, AMQP, or NATS
- Write CloudEvents code in Go (`sdk-go`) or C#/.NET (`sdk-csharp`)
- Decide between structured mode vs binary mode for a transport
- Add extension attributes (tracing, partitioning, sequence, dataref)
- Correlate CloudEvents with OpenTelemetry / distributed tracing
- Apply CloudEvents to microservices, serverless, or webhook fan-out scenarios

---

## CloudEvents Specification at a Glance

CloudEvents is a **CNCF-graduated** (Jan 2024) vendor-neutral spec for describing event data. It solves the "every producer has its own envelope" problem by defining a minimal, portable set of metadata attributes.

### Required Attributes

| Attribute      | Type       | Description |
|----------------|------------|-------------|
| `specversion`  | String     | Always `"1.0"` |
| `id`           | String     | Unique per `source`. Use UUIDs. Re-send of same event keeps same `id`. |
| `source`       | URI-ref    | Context of the originating occurrence. Reverse-DNS or URI. E.g., `/orders/service` or `https://myapp.io/payments` |
| `type`         | String     | Reverse-DNS dot-notation verb. E.g., `com.example.order.created` |

### Optional (but highly recommended) Attributes

| Attribute           | Type      | Description |
|---------------------|-----------|-------------|
| `time`              | Timestamp | RFC 3339 UTC. Always include it. |
| `datacontenttype`   | String    | MIME type of `data`. E.g., `application/json` |
| `dataschema`        | URI       | Schema for `data` (JSON Schema, Avro, Protobuf schema URL) |
| `subject`           | String    | Entity within `source`, but with type. E.g. the order ID - "order:123". |
| `data`              | Any       | Event payload. Opaque to the spec. |

### Naming Conventions

- `type`: `<reverse-dns>.<noun>.<past-tense-verb>` — `com.myco.order.shipped`
- `source`: stable URI identifying the producer system, not an instance
- `id`: globally unique — combine `source + id` for deduplication
- Extension attribute names: lowercase alphanumeric, no hyphens, max 20 chars

---

## JSON Wire Format

```json
{
  "specversion": "1.0",
  "id": "a3f1c2d4-1234-4abc-8765-aabbccddeeff",
  "source": "https://myapp.io/orders",
  "type": "com.myapp.order.created",
  "subject": "order:42",
  "time": "2025-03-27T15:04:05Z",
  "datacontenttype": "application/json",
  "data": {
    "orderId": 42,
    "customerId": 7,
    "total": 199.99
  }
}
```

Content-Type header for structured mode: `application/cloudevents+json; charset=utf-8`

---

## Content Modes

| Mode        | When to Use |
|-------------|-------------|
| **Structured** | All CloudEvent fields (attributes + data) go into the message body as a single JSON object. Simpler, self-contained. Preferred for most cases. |
| **Binary**     | `data` goes into the body; attributes go into transport metadata (HTTP headers: `ce-*`, Kafka record headers). Lower overhead, better interop with non-CE consumers of the raw body. |
| **Batch**      | Array of structured CloudEvents in one HTTP body (`application/cloudevents-batch+json`). For HTTP only. |

---

## Go SDK

### Install

```bash
go get github.com/cloudevents/sdk-go/v2
```

### Produce — HTTP

```go
package main

import (
    "context"
    "log"

    cloudevents "github.com/cloudevents/sdk-go/v2"
    "github.com/google/uuid"
)

func main() {
    c, err := cloudevents.NewClientHTTP()
    if err != nil {
        log.Fatalf("create client: %v", err)
    }

    event := cloudevents.NewEvent()
    event.SetID(uuid.NewString())
    event.SetSource("https://myapp.io/orders")
    event.SetType("com.myapp.order.created")
    event.SetSubject("order:42")
    event.SetDataContentType(cloudevents.ApplicationJSON)
    event.SetData(cloudevents.ApplicationJSON, map[string]any{
        "orderId":    42,
        "customerId": 7,
        "total":      199.99,
    })

    ctx := cloudevents.ContextWithTarget(context.Background(), "http://consumer-svc/events")
    if result := c.Send(ctx, event); cloudevents.IsUndelivered(result) {
        log.Fatalf("send failed: %v", result)
    }
}
```

### Consume — HTTP

```go
package main

import (
    "context"
    "fmt"
    "log"

    cloudevents "github.com/cloudevents/sdk-go/v2"
)

func handle(ctx context.Context, event cloudevents.Event) {
    fmt.Printf("Received [%s] %s from %s\n", event.Type(), event.ID(), event.Source())
    // Unmarshal data
    var payload map[string]any
    if err := event.DataAs(&payload); err != nil {
        fmt.Printf("bad data: %v\n", err)
        return
    }
    fmt.Printf("data: %v\n", payload)
}

func main() {
    c, err := cloudevents.NewClientHTTP()
    if err != nil {
        log.Fatalf("create client: %v", err)
    }
    // Listens on :8080 by default
    if err := c.StartReceiver(context.Background(), handle); err != nil {
        log.Fatalf("receiver: %v", err)
    }
}
```

### Produce — Kafka (sarama)

```go
import (
    "github.com/IBM/sarama"
    kafka "github.com/cloudevents/sdk-go/protocol/kafka_sarama/v2"
    cloudevents "github.com/cloudevents/sdk-go/v2"
)

saramaConfig := sarama.NewConfig()
saramaConfig.Version = sarama.V2_0_0_0

sender, _ := kafka.NewSender([]string{"kafka:9092"}, saramaConfig, "my-topic")
defer sender.Close(context.Background())

c, _ := cloudevents.NewClient(sender, cloudevents.WithTimeNow(), cloudevents.WithUUIDs())

event := cloudevents.NewEvent()
event.SetType("com.myapp.order.created")
event.SetSource("https://myapp.io/orders")
event.SetData(cloudevents.ApplicationJSON, payload)

// Use event ID as Kafka partition key for ordering
c.Send(kafka.WithMessageKey(ctx, sarama.StringEncoder(event.ID())), event)
```

### Consume — Kafka (sarama)

```go
receiver, _ := kafka.NewConsumer([]string{"kafka:9092"}, saramaConfig, "my-group-id", "my-topic")
defer receiver.Close(context.Background())

c, _ := cloudevents.NewClient(receiver)
c.StartReceiver(context.Background(), handle)
```

---

## C# / .NET SDK

### Install

```xml
<PackageReference Include="CloudNative.CloudEvents.SystemTextJson" Version="2.*" />
<!-- Choose your transport: -->
<PackageReference Include="CloudNative.CloudEvents.AspNetCore" Version="2.*" />  <!-- HTTP -->
<PackageReference Include="CloudNative.CloudEvents.Kafka" Version="2.*" />       <!-- Kafka (Confluent) -->
<PackageReference Include="CloudNative.CloudEvents.Amqp" Version="2.*" />        <!-- AMQP -->
```

### Create an Event

```csharp
using CloudNative.CloudEvents;
using CloudNative.CloudEvents.SystemTextJson;

var cloudEvent = new CloudEvent
{
    Id = Guid.NewGuid().ToString(),
    Type = "com.myapp.order.created",
    Source = new Uri("https://myapp.io/orders"),
    Subject = "order:42",
    Time = DateTimeOffset.UtcNow,
    DataContentType = "application/json",
    Data = new { orderId = 42, customerId = 7, total = 199.99 }
};
```

### Produce — HTTP (HttpClient)

```csharp
using CloudNative.CloudEvents.Http;
using CloudNative.CloudEvents.SystemTextJson;

var formatter = new JsonEventFormatter();

// Structured mode (recommended)
var request = cloudEvent.ToHttpRequestMessage(ContentMode.Structured, formatter);
request.RequestUri = new Uri("http://consumer-svc/events");
await httpClient.SendAsync(request);
```

### Consume — ASP.NET Core

```csharp
// Program.cs / Startup
builder.Services.AddCloudEventsMvcCore();   // registers formatter

// Controller
[HttpPost("/events")]
public async Task<IActionResult> Receive([FromBody] CloudEvent cloudEvent)
{
    _logger.LogInformation("Got {Type} id={Id} from {Source}",
        cloudEvent.Type, cloudEvent.Id, cloudEvent.Source);

    var order = cloudEvent.Data.Deserialize<OrderCreatedPayload>();
    // ...
    return NoContent();
}
```

### Produce — Kafka (Confluent)

```csharp
using CloudNative.CloudEvents.Kafka;
using Confluent.Kafka;

var producer = new ProducerBuilder<string?, byte[]>(new ProducerConfig
{
    BootstrapServers = "kafka:9092"
}).Build();

var formatter = new JsonEventFormatter();

var message = cloudEvent.ToKafkaMessage(ContentMode.Structured, formatter);
await producer.ProduceAsync("my-topic", message);
```

### Consume — Kafka (Confluent)

```csharp
var consumer = new ConsumerBuilder<string?, byte[]>(/* config */).Build();
consumer.Subscribe("my-topic");

var formatter = new JsonEventFormatter();

while (true)
{
    var msg = consumer.Consume();
    var cloudEvent = msg.Message.ToCloudEvent(formatter);
    Console.WriteLine($"[{cloudEvent.Type}] {cloudEvent.Id}");
}
```

---

## Extension Attributes

Read the references/extensions.md file for details. Common ones:

| Extension        | Key             | Use Case |
|------------------|-----------------|----------|
| Distributed Tracing | `traceparent`, `tracestate` | W3C Trace Context propagation |
| Partitioning     | `partitionkey`  | Kafka partition ordering |
| Sequence         | `sequence`, `sequencetype` | Ordered event streams |
| Dataref          | `dataref`       | Claim-Check pattern (pointer to large payload) |
| Expiry           | `expiry`        | TTL for the event |
| Sampling         | `samplingrate`  | Observability sampling hint |

### Setting Extension Attributes in Go

```go
event.SetExtension("partitionkey", "customer-7")
event.SetExtension("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
```

### Setting Extension Attributes in C#

```csharp
cloudEvent["partitionkey"] = "customer-7";
cloudEvent["traceparent"] = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
```

---

## Observability & Tracing

Integrate with OpenTelemetry using the [Distributed Tracing Extension](https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md):

1. On the **producer**: inject W3C `traceparent`/`tracestate` into the event via extension attributes before sending.
2. On the **consumer**: extract `traceparent`/`tracestate` from the received CloudEvent and restore the span context.
3. Never modify the tracing extension once set on an event.

OpenTelemetry semantic conventions:
- Span name (produce): `CloudEvents Create <type>`
- Span name (consume): `CloudEvents Process <type>`
- Span attributes: `cloudevents.event_id`, `cloudevents.event_source`, `cloudevents.event_type`

---

## Idempotency & Deduplication

- Consumers MUST be idempotent. `id` + `source` form the natural deduplication key.
- Store processed `id`s in a small cache (Redis, DB unique index) keyed by `source + id`.
- A re-delivery of the same logical event MUST share the same `id`. A retry from the broker is the same message, not a new one.
- Different occurrences of the same *type* of event are distinct and get distinct `id`s.

---

## Event Schema Design

### Type Convention

```
<reverse-dns>.<aggregate>.<past-tense-verb>
```

Examples:
- `com.myco.order.created`
- `com.myco.order.payment.captured`
- `com.myco.inventory.item.reserved`

### Source Convention

Stable, durable URI representing the *producing system*, not a process instance:
- `https://myapp.io/orders`
- `/services/inventory`
- `urn:myco:payments-service`

Avoid putting hostnames or pod IPs in `source` — they change.

### When to Use `subject`

Use `subject` to identify the *entity* within `source`. Enables routing/filtering without deserializing `data`:
- Order service events → `subject: order:<id>`
- User events → `subject: user:<uuid>`

---

## Protocol Binding Reference

| Transport | SDK (Go)                             | SDK (C#)                          | Modes |
|-----------|--------------------------------------|-----------------------------------|-------|
| HTTP      | `cloudevents/sdk-go/v2` (built-in)   | `CloudNative.CloudEvents.AspNetCore` | structured, binary, batch |
| Kafka     | `sdk-go/protocol/kafka_sarama/v2`    | `CloudNative.CloudEvents.Kafka`   | structured, binary |
| AMQP      | not in main SDK (community)          | `CloudNative.CloudEvents.Amqp`    | structured, binary |
| NATS      | community binding                    | not official                      | structured |
| MQTT      | community / manual                   | not official                      | structured |
| WebSocket | draft spec                           | not official                      | structured |

---

## Common Mistakes & Anti-Patterns

| Anti-Pattern | Correct Approach |
|---|---|
| Putting routing logic in `data` | Use `type` and `subject` for routing; keep `data` as domain payload |
| Using mutable `source` (pod IP, hostname) | Use a stable URI (service name / URN) |
| Omitting `time` | Always set `time` to RFC 3339 UTC at the moment of occurrence |
| Using `type` as a verb in imperative mood (`order.create`) | Use past-tense (`order.created`) — CloudEvents describe *occurrences* |
| Reusing the same `id` for different occurrences | New occurrence = new UUID in `id` |
| Putting large binary payloads in `data` | Use the `dataref` extension (Claim-Check pattern) |
| Not validating `specversion` on the consumer | Always check `specversion == "1.0"` |
| Skipping idempotency on consumers | Always deduplicate on `source + id` |

---

## Workflow for Implementing CloudEvents

1. **Design the schema first** — define `type`, `source`, `subject` conventions before writing code.
2. **Choose a transport** — pick HTTP for simple webhook/push patterns; Kafka for durable, ordered streams; AMQP for broker-based messaging.
3. **Choose content mode** — structured for simplicity; binary when consumers need raw body without CE parsing.
4. **Select the SDK** — `sdk-go` for Go, `sdk-csharp` for .NET (both are the official CNCF SDKs).
5. **Implement producers** — build the event, set required attributes + `time`, send.
6. **Implement consumers** — parse the event, validate type, extract data, handle idempotently.
7. **Add extension attributes** — at minimum, propagate distributed tracing via `traceparent`.
8. **Test** — send a raw HTTP POST with `application/cloudevents+json` content-type to verify your consumer; use `curl` for quick checks.

---

## Quick curl Test

```bash
curl -X POST http://localhost:8080/events \
  -H "Content-Type: application/cloudevents+json" \
  -d '{
    "specversion": "1.0",
    "id": "test-001",
    "source": "https://test.local",
    "type": "com.example.test.fired",
    "time": "2025-03-27T15:00:00Z",
    "datacontenttype": "application/json",
    "data": {"hello": "world"}
  }'
```

Binary mode curl (HTTP):

```bash
curl -X POST http://localhost:8080/events \
  -H "ce-specversion: 1.0" \
  -H "ce-id: test-002" \
  -H "ce-source: https://test.local" \
  -H "ce-type: com.example.test.fired" \
  -H "ce-time: 2025-03-27T15:00:00Z" \
  -H "Content-Type: application/json" \
  -d '{"hello": "world"}'
```
