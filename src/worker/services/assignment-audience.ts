/** Aliases must be developer-provided SQL identifiers, never request values. */
export function assignmentEligible(assignment:string,student:string):string {
 return `(NOT EXISTS (SELECT 1 FROM assignment_audiences aud WHERE aud.assignment_id=${assignment}.id)
 OR EXISTS (SELECT 1 FROM assignment_audience_students target WHERE target.assignment_id=${assignment}.id AND target.student_id=${student}))`;
}
