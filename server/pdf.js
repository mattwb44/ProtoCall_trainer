import PDFDocument from 'pdfkit';

// Renders a completed session for one requester: their answers, pushed answers,
// official answers, and their notes. Returns the PDFDocument stream.
export function sessionPdf({ session, questions, responses, notes, my_participant_id }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } });

  const rose = '#e11d48', amber = '#d97706', emerald = '#059669', slate = '#334155', gray = '#64748b';

  doc.fillColor(rose).fontSize(10).font('Helvetica-Bold').text('PROTOCALL TRAINER — TRAINING RECORD');
  doc.moveDown(0.3);
  doc.fillColor('#0f172a').fontSize(18).text(session.title);
  doc.fillColor(gray).fontSize(10).font('Helvetica')
    .text(`${session.category} · ${session.subcategory}   |   Room ${session.room_code}   |   ${session.started_at}${session.ended_at ? ` – ${session.ended_at}` : ''}`);
  doc.moveDown(0.8);

  if (session.description) {
    doc.fillColor(rose).fontSize(9).font('Helvetica-Bold').text('DISPATCH');
    doc.fillColor(slate).fontSize(10).font('Helvetica').text(session.description);
    doc.moveDown(0.8);
  }

  questions.forEach((q, i) => {
    if (doc.y > 660) doc.addPage();
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold')
      .text(`Q${i + 1}. ${q.role_track ? `[${q.role_track}] ` : ''}${q.prompt}`);
    doc.moveDown(0.25);

    const mine = responses.find(r => r.question_id === q.id && r.participant_id === my_participant_id);
    if (mine) {
      doc.fillColor(gray).fontSize(8).font('Helvetica-Bold').text('YOUR ANSWER');
      doc.fillColor(slate).fontSize(10).font('Helvetica').text(mine.body);
      doc.moveDown(0.25);
    }

    for (const p of responses.filter(r => r.question_id === q.id && r.is_pushed)) {
      doc.fillColor(rose).fontSize(8).font('Helvetica-Bold').text(`PUSHED BY INSTRUCTOR · ${p.display_tag}${p.shift_label ? ` · Shift ${p.shift_label}` : ''}`);
      doc.fillColor(slate).fontSize(10).font('Helvetica').text(p.body);
      doc.moveDown(0.25);
    }

    if (q.instructor_answer) {
      doc.fillColor(emerald).fontSize(8).font('Helvetica-Bold').text('OFFICIAL ANSWER');
      doc.fillColor(slate).fontSize(10).font('Helvetica').text(q.instructor_answer);
      doc.moveDown(0.25);
    }

    const note = notes.find(n => n.question_id === q.id);
    if (note) {
      doc.fillColor(amber).fontSize(8).font('Helvetica-Bold').text('YOUR NOTES');
      doc.fillColor(slate).fontSize(10).font('Helvetica').text(note.body);
    }
    doc.moveDown(0.7);
  });

  doc.end();
  return doc;
}
