# CloudEvents Extension Attributes Reference

Source: https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/README.md

Extension attributes are OPTIONAL. Support for any extension is OPTIONAL per the spec. Names must be lowercase alphanumeric, max 20 chars, no hyphens.

---

## Distributed Tracing

**Spec**: https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md

Carries W3C Trace Context.

| Attribute    | Type   | Description |
|--------------|--------|-------------|
| `traceparent` | String | W3C traceparent header value |
| `tracestate`  | String | W3C tracestate header value |

Rules:
- Set on the producer at event creation.
- MUST NOT be modified once set.
- Consumer extracts and restores span context.

---

## Partitioning

**Spec**: https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/partitioning.md

| Attribute      | Type   | Description |
|----------------|--------|-------------|
| `partitionkey` | String | Key used by a message broker to assign the event to a partition/shard. |

Use: set to aggregate ID (e.g., `customer-7`) to guarantee ordering of events for the same entity in Kafka.

---

## Sequence

**Spec**: https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/sequence.md

| Attribute      | Type   | Description |
|----------------|--------|-------------|
| `sequence`     | String | Position in ordered event stream from a single source |
| `sequencetype` | String | Type of sequence (`Integer` for monotonic integer) |

Use: explicit ordering when the broker doesn't guarantee it, or for consumers that need to detect gaps.

---

## Dataref (Claim-Check Pattern)

**Spec**: https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/dataref.md

| Attribute | Type | Description |
|-----------|------|-------------|
| `dataref` | URI  | Reference to external storage where the event payload lives |

Use: when `data` would be too large to embed inline (large binaries, documents, etc.). Consumer fetches from the URI. May require out-of-band authorization.

Example: `"dataref": "https://storage.myco.io/events/payloads/abc123"`

---

## Expiry Time

| Attribute | Type      | Description |
|-----------|-----------|-------------|
| `expiry`  | Timestamp | RFC 3339 UTC. Consumer SHOULD discard event if current time > expiry. |

---

## Sampling

| Attribute      | Type    | Description |
|----------------|---------|-------------|
| `samplingrate` | Integer | 0–100 (percentage) or 0–1000000 (per-million). Hint to sampling infrastructure. |

---

## Auth Context

Carries authentication/authorization info about the originating subject.

| Attribute       | Type   | Description |
|-----------------|--------|-------------|
| `authtype`      | String | Auth scheme (e.g., `JWT`, `APIKEY`) |
| `authtokenhash` | String | Hash of the auth token (not the token itself) |

---

## BAM (Business Activity Monitoring)

Correlates events to business processes.

| Attribute           | Type   |
|---------------------|--------|
| `businessprocessid` | String |
| `instanceid`        | String |
| `steptypeclass`     | String |

---

## Data Classification

| Attribute          | Type   | Description |
|--------------------|--------|-------------|
| `dataclassification` | String | Data sensitivity level, e.g. `public`, `internal`, `confidential` |

---

## Severity

| Attribute  | Type   | Description |
|------------|--------|-------------|
| `severity` | String | Syslog-style severity: `TRACE`, `DEBUG`, `INFO`, `NOTICE`, `WARNING`, `ERROR`, `CRITICAL`, `ALERT`, `EMERGENCY` |

---

## Custom Extensions

You can define your own. Rules:
- Name: lowercase alphanumeric only, max 20 chars
- Value: any CloudEvents type (String, URI, Timestamp, Integer, Boolean, Binary)
- Document them alongside your event schema
- Do NOT prefix with `ce-` (that's reserved for HTTP header transport encoding)

```go
// Go
event.SetExtension("mycompanycorrid", correlationID)
```

```csharp
// C#
cloudEvent["mycompanycorrid"] = correlationID;
```
