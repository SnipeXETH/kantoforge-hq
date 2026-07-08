import React, { useState } from "react";
import { uid, shortDate } from "../lib/format";

const COLUMNS = [
  ["todo", "To do"],
  ["doing", "In progress"],
  ["done", "Done"],
];

const PRIORITIES = { high: ["red", "High"], normal: ["gray", "Normal"], low: ["gray", "Low"] };

export default function TasksPage({ db, update, user }) {
  const [form, setForm] = useState({ title: "", notes: "", assigneeId: user.id, priority: "normal", due: "" });
  const [showForm, setShowForm] = useState(false);

  const addTask = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const task = {
      id: uid(),
      title: form.title.trim(),
      notes: form.notes.trim(),
      assigneeId: form.assigneeId || null,
      priority: form.priority,
      due: form.due || null,
      status: "todo",
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    update((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    setForm({ title: "", notes: "", assigneeId: user.id, priority: "normal", due: "" });
    setShowForm(false);
  };

  const move = (id, status) => update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, status } : t)) }));
  const remove = (id) => update((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));

  const userName = (id) => {
    const u = db.users.find((x) => x.id === id);
    return u ? u.name : "Unassigned";
  };
  const initials = (name) =>
    name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const overdue = (t) => t.due && t.status !== "done" && new Date(t.due) < new Date(new Date().toDateString());

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team tasks</h1>
          <div className="sub">Everyone sees the same board. Keep the business moving.</div>
        </div>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? "Cancel" : "+ New task"}</button>
      </div>

      {showForm && (
        <form className="card mb" onSubmit={addTask}>
          <div className="form-row">
            <label className="field" style={{ flex: 3 }}>
              <span className="lab">Task</span>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Photograph new Lorcana cases" autoFocus />
            </label>
            <label className="field">
              <span className="lab">Assignee</span>
              <select value={form.assigneeId || ""} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Unassigned</option>
                {db.users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="lab">Priority</span>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="field">
              <span className="lab">Due</span>
              <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="lab">Notes (optional)</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <button className="btn primary">Add task</button>
        </form>
      )}

      <div className="board">
        {COLUMNS.map(([status, label]) => {
          const tasks = db.tasks.filter((t) => t.status === status);
          return (
            <div className="column" key={status}>
              <h3>
                {label} <span className="count">{tasks.length}</span>
              </h3>
              {tasks.map((t) => (
                <div className="task-card" key={t.id}>
                  <div className="t-title">{t.title}</div>
                  {t.notes && <div className="t-notes">{t.notes}</div>}
                  <div className="t-meta">
                    <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }} title={userName(t.assigneeId)}>
                      {t.assigneeId ? initials(userName(t.assigneeId)) : "—"}
                    </span>
                    <span className="muted small">{userName(t.assigneeId)}</span>
                    {t.priority !== "normal" && <span className={"badge " + PRIORITIES[t.priority][0]}>{PRIORITIES[t.priority][1]}</span>}
                    {t.due && (
                      <span className={"badge " + (overdue(t) ? "red" : "gray")}>
                        {overdue(t) ? "⚠ " : "📅 "}{shortDate(t.due)}
                      </span>
                    )}
                  </div>
                  <div className="t-actions">
                    {status !== "todo" && <button className="btn small" onClick={() => move(t.id, status === "done" ? "doing" : "todo")}>←</button>}
                    {status !== "done" && <button className="btn small" onClick={() => move(t.id, status === "todo" ? "doing" : "done")}>{status === "doing" ? "Done ✓" : "Start →"}</button>}
                    <span className="spacer" />
                    <button className="btn small danger" onClick={() => remove(t.id)}>✕</button>
                  </div>
                </div>
              ))}
              {!tasks.length && <div className="muted small" style={{ padding: "6px 4px" }}>Nothing here.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
