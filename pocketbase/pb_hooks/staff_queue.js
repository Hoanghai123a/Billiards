module.exports.requestActorId = (event) => {
  try {
    const auth = event.requestInfo().auth
    return auth ? String(auth.id || "") : ""
  } catch (e) { return "" }
}

module.exports.signalEventType = (record) => ["done", "cancelled"].includes(String(record.get("queue_status") || "")) ? "history" : "queue"

const hasField = (record, name) => {
  try { return Boolean(record.collection().fields.getByName(name)) } catch (e) { return false }
}

module.exports.signalStaffQueue = (app, store, actorId = "", eventType = "queue") => {
  if (!store) return
  try {
    let signal
    try { signal = app.findFirstRecordByFilter("staff_queue_signals", "store = {:store}", { store }) }
    catch (e) {
      signal = new Record(app.findCollectionByNameOrId("staff_queue_signals"))
      signal.set("store", store)
      signal.set("revision", 0)
    }
    signal.set("revision", (Number(signal.get("revision")) || 0) + 1)
    if (hasField(signal, "actor_id")) signal.set("actor_id", actorId || "")
    if (hasField(signal, "event_type")) signal.set("event_type", eventType || "queue")
    app.save(signal)
  } catch (e) { console.error("Failed to publish staff queue update:", e) }
}
