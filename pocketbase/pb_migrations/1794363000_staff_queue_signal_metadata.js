/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const signals = app.findCollectionByNameOrId("staff_queue_signals")
  if (!signals.fields.getByName("actor_id")) signals.fields.add(new TextField({ id: "text_queue_signal_actor", name: "actor_id", required: false, max: 40, min: 0, pattern: "" }))
  if (!signals.fields.getByName("event_type")) signals.fields.add(new SelectField({ id: "select_queue_signal_event_type", name: "event_type", required: false, maxSelect: 1, values: ["queue", "history"] }))
  app.save(signals)
}, (app) => {
  const signals = app.findCollectionByNameOrId("staff_queue_signals")
  for (const name of ["actor_id", "event_type"]) {
    try { signals.fields.removeByName(name) } catch (e) {}
  }
  app.save(signals)
})
