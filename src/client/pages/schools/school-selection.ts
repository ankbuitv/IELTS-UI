/** Only a current approved membership can restore a remembered school. */
export function resolveSchoolSelection<T extends {id:string;status:string;member_status:string}>(schools:T[], savedId:string) {
  const approved = schools.filter(s => s.status === 'APPROVED' && s.member_status === 'ACTIVE');
  const selected = approved.find(s => s.id === savedId) ?? (approved.length === 1 ? approved[0] : undefined);
  return { approved, selected, needsChoice: approved.length > 1 && !selected };
}
