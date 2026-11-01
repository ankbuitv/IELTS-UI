/** SQL predicate and its two teacher-id bindings for a student's authorized class work. */
export function teacherAttemptScope(alias:'a'|'x'):string {
 return `EXISTS (SELECT 1 FROM assignments scoped_assignment
 JOIN classrooms scoped_class ON scoped_class.id=scoped_assignment.classroom_id
 JOIN classroom_members scoped_student ON scoped_student.classroom_id=scoped_class.id AND scoped_student.user_id=${alias}.user_id AND scoped_student.role='STUDENT' AND scoped_student.status='ACTIVE'
 WHERE scoped_assignment.id=${alias}.assignment_id AND scoped_assignment.status IN ('ACTIVE','CLOSED')
 AND (scoped_class.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members scoped_teacher WHERE scoped_teacher.classroom_id=scoped_class.id AND scoped_teacher.user_id=? AND scoped_teacher.role='CO_TEACHER' AND scoped_teacher.status='ACTIVE'))) `;
}
