/** 
 * @komerce-arch-lite
 * @role hub-v1-chromium-recording-evidence-policy
 * @domain dashboard
 * @layer script
 * @owner backend-core
 * @purpose Distinguer lecture scopée du Relais et visibilité des commandes de la fixture sans faux PASS métier.
 * @impact-areas staging-only, dashboard, authorization
 */
'use strict';
function evaluateRecording(e) {
 const pages = Array.isArray(e.route_reads) ? e.route_reads.filter(x=>x.kind!=='ORDER_360_READBACK') : [];
 const clicks = Array.isArray(e.clicks) ? e.clicks : [];
 const common = e.sha_stable===true && e.video_encrypted===true && e.trace_encrypted===true &&
   e.blocked_writes===0 && e.blocked_external===0 && e.browser_errors===0 &&
   pages.length>=2 && pages.every(x=>x.http===200 && typeof x.path==='string' && x.path.startsWith('/admin/')) &&
   clicks.some(x=>x.kind==='REAL_UI_CLICK' && typeof x.href==='string' && x.href.startsWith('/admin/') && x.actual===new URL(x.href,'https://komerce-backend-production.up.railway.app').pathname);
 if(!common)return 'HOLD_NOT_PROVEN';
 if(e.role==='agent_relais'){
  const s=e.relay_scope||{};
  if(s.identity_http!==200 || s.role_verified!==true || s.action_center_http!==200 || s.central_admin_http!==403)
    return 'HOLD_NOT_PROVEN';
  return (e.found_fixture_refs||[]).length>0?'PASS_READONLY_RECORDING':'PASS_SCOPED_READONLY_RECORDING';
 }
 return (e.found_fixture_refs||[]).length>0?'PASS_READONLY_RECORDING':'HOLD_NOT_PROVEN';
}
module.exports={evaluateRecording};
