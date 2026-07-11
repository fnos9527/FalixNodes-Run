# FalixNodes-Run

VLESS_LINK         
FALIX_EMAIL    
FALIX_PASSWORD    


https://api.github.com/repos/{你的GitHub用户名}/{你的仓库名}/dispatches

Accept : application/vnd.github+json      
Authorization : Bearer ghp_xxxxxxxxxxxx      
User-Agent : cron-job-request     
Request Body:    
```
{
  "event_type": "trigger-cron"
}
