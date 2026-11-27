/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const layouts = app.findCollectionByNameOrId("table_layouts")
  if (!layouts.fields.getByName("sort_order")) {
    layouts.fields.add(new SelectField({
      id: "select_layout_sort_order",
      name: "sort_order",
      maxSelect: 1,
      values: ["row", "column"],
      required: false,
      system: false,
      hidden: false,
      presentable: false,
    }))
    app.save(layouts)
  }
}, (app) => {
  const layouts = app.findCollectionByNameOrId("table_layouts")
  layouts.fields.removeByName("sort_order")
  app.save(layouts)
})
