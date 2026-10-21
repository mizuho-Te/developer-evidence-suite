"""Run an explicit argv, recording time and child high-water memory; no shell."""
import json, resource, subprocess, sys, time
started=time.monotonic()
result=subprocess.run(sys.argv[2:],check=False)
r=resource.getrusage(resource.RUSAGE_CHILDREN)
with open(sys.argv[1],'w') as f: json.dump({'command':sys.argv[2:],'exitCode':result.returncode,'elapsedSeconds':time.monotonic()-started,'maxRssKiB':r.ru_maxrss,'userSeconds':r.ru_utime,'systemSeconds':r.ru_stime,'note':'Linux wait4 child-process max RSS, not simultaneous process-tree aggregate'},f,indent=2)
sys.exit(result.returncode)
