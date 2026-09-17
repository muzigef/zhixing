// Windows 10+ AppContainer host. No capabilities, inherited user environment or
// executable fallback. The process starts suspended; job limits are installed
// before any untrusted instruction can run. Build with the OS .NET compiler.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

class Sandbox {
  static string stage="input";
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid, Capabilities; public int CapabilityCount, Reserved; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved, desktop, title; public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reserved2; public IntPtr reservedPtr,stdin,stdout,stderr; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeProcess; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct JOB_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct JOB_PORT { public IntPtr key,port; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateIoCompletionPort(IntPtr file,IntPtr existing,UIntPtr key,uint threads);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetQueuedCompletionStatus(IntPtr port,out uint code,out UIntPtr key,out IntPtr data,uint timeout);
  [DllImport("kernel32.dll", SetLastError=true, EntryPoint="SetInformationJobObject")] static extern bool SetJobPort(IntPtr job,int infoClass,ref JOB_PORT info,uint size);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,uint count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int infoClass,ref JOB_LIMIT info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY_ATTRIBUTES attrs,int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,int mask,int flags);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string path,uint access,uint share,ref SECURITY_ATTRIBUTES attrs,uint disposition,uint flags,IntPtr template);
  static void Check(bool ok, [System.Runtime.CompilerServices.CallerLineNumber] int line=0) { if (!ok) throw new Exception("win32_"+Marshal.GetLastWin32Error()+"_at_"+line); }
  static string Quote(string value) { return "\""+System.Text.RegularExpressions.Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"").TrimEnd('\0').Replace("\0", "")+new string('\\', value.Reverse().TakeWhile(c=>c=='\\').Count())+"\""; }
  static void Grant(string directory, SecurityIdentifier sid, FileSystemRights rights) {
    var info=new DirectoryInfo(directory); var acl=info.GetAccessControl();
    acl.AddAccessRule(new FileSystemAccessRule(sid,rights,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    info.SetAccessControl(acl);
  }
  class OutputBudget { public long bytes; public int exceeded; public int max; }
  static Task<string> Capture(IntPtr handle, OutputBudget budget) {
    return Task.Run(()=> { using(var file=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read)) using(var output=new MemoryStream()) {
      var buffer=new byte[4096]; int count;
      while((count=file.Read(buffer,0,buffer.Length))>0) {
        long total=Interlocked.Add(ref budget.bytes,count); int accepted=(int)Math.Max(0,Math.Min(count,budget.max-(total-count)));
        if(accepted>0) output.Write(buffer,0,accepted);
        if(total>budget.max) Interlocked.Exchange(ref budget.exceeded,1);
      }
      // Incomplete UTF-8 at the byte boundary is omitted by the TS decoder.
      return Convert.ToBase64String(output.ToArray());
    }});
  }
  static bool WorkspaceExceeded(string directory, ref long bytes, ref int files, long maximum, int maxFiles, int depth) {
    if(depth>32) return true;
    foreach(var item in new DirectoryInfo(directory).EnumerateFileSystemInfos()) {
      if(++files>maxFiles) return true;
      if((item.Attributes&FileAttributes.ReparsePoint)!=0) continue;
      if((item.Attributes&FileAttributes.Directory)!=0) { if(WorkspaceExceeded(item.FullName,ref bytes,ref files,maximum,maxFiles,depth+1)) return true; }
      else { bytes+=((FileInfo)item).Length; if(bytes>maximum) return true; }
    }
    return false;
  }
  static long Limit(Dictionary<string,object> policy,string key,long min,long max) {
    long value=Convert.ToInt64(policy[key]); if(value<min || value>max) throw new Exception("sandbox_policy_invalid"); return value;
  }
  static string ResourceEvent(IntPtr port) {
    uint code; UIntPtr key; IntPtr data;
    while(GetQueuedCompletionStatus(port,out code,out key,out data,0)) { if(code==9 || code==10) return "memory"; if(code==1 || code==2) return "cpu"; }
    return null;
  }
  static object Run(Dictionary<string,object> input) {
    var root=Path.GetFullPath((string)input["root"]); var work=Path.Combine(root,"work"); var runtime=Path.Combine(root,"runtime");
    var exe=Path.GetFullPath((string)input["executable"]);
    if(!exe.StartsWith(runtime+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) || !Directory.Exists(work)) throw new Exception("sandbox_runtime_invalid");
    var args=((System.Collections.IEnumerable)input["args"]).Cast<string>().ToArray();
    if(args.Any(a=>a.IndexOf('\0')>=0)) throw new Exception("sandbox_argument_invalid");
    var config=(Dictionary<string,object>)input["policy"];
    int timeout=(int)Limit(config,"timeoutMs",1,300000);
    long memory=Limit(config,"memoryBytes",67108864,1073741824), cpu=Limit(config,"cpuSeconds",1,120), disk=Limit(config,"workspaceBytes",65536,67108864);
    int fileLimit=(int)Limit(config,"workspaceFiles",1,1024), outputLimit=(int)Limit(config,"outputBytes",1024,2000000);
    var profile="Zhixing.Sandbox."+Guid.NewGuid().ToString("N");
    IntPtr sid=IntPtr.Zero,job=IntPtr.Zero,attrs=IntPtr.Zero,capPtr=IntPtr.Zero,policy=IntPtr.Zero,env=IntPtr.Zero,handles=IntPtr.Zero;
    IntPtr port=IntPtr.Zero;
    IntPtr outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,nil=IntPtr.Zero;
    PROCESS_INFORMATION process=new PROCESS_INFORMATION(); bool created=false,profileCreated=false;
    try {
      stage="profile";
      int hr=CreateAppContainerProfile(profile,"Zhixing isolated test","Temporary code execution",IntPtr.Zero,0,out sid);
      if(hr!=0) throw new Exception("appcontainer_"+hr); profileCreated=true;
      stage="permissions";
      var identity=new SecurityIdentifier(sid);
      Grant(root,identity,FileSystemRights.ReadAndExecute);
      Grant(runtime,identity,FileSystemRights.ReadAndExecute);
      Grant(work,identity,FileSystemRights.Modify);
      stage="job";
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
      port=CreateIoCompletionPort(new IntPtr(-1),IntPtr.Zero,UIntPtr.Zero,1); Check(port!=IntPtr.Zero);
      var jobPort=new JOB_PORT(); jobPort.port=port; Check(SetJobPort(job,7,ref jobPort,(uint)Marshal.SizeOf(jobPort)));
      var limits=new JOB_LIMIT(); limits.basic.flags=0x2000|0x8|0x100|0x2; limits.basic.activeProcess=1; limits.processMemory=new UIntPtr((ulong)memory); limits.basic.processTime=cpu*10000000;
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)));
      stage="attributes";
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,3,0,ref size); attrs=Marshal.AllocHGlobal(size);
      Check(InitializeProcThreadAttributeList(attrs,3,0,ref size));
      var caps=new SECURITY_CAPABILITIES(); caps.AppContainerSid=sid;
      capPtr=Marshal.AllocHGlobal(Marshal.SizeOf(caps)); Marshal.StructureToPtr(caps,capPtr,false);
      Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20009),capPtr,new IntPtr(Marshal.SizeOf(caps)),IntPtr.Zero,IntPtr.Zero));
      policy=Marshal.AllocHGlobal(4); Marshal.WriteInt32(policy,1); // PROCESS_CREATION_CHILD_PROCESS_RESTRICTED
      Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x2000E),policy,new IntPtr(4),IntPtr.Zero,IntPtr.Zero));
      stage="pipes";
      var sa=new SECURITY_ATTRIBUTES(); sa.nLength=Marshal.SizeOf(sa); sa.bInheritHandle=1;
      Check(CreatePipe(out outRead,out outWrite,ref sa,0)); Check(SetHandleInformation(outRead,1,0));
      Check(CreatePipe(out errRead,out errWrite,ref sa,0)); Check(SetHandleInformation(errRead,1,0));
      nil=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero); Check(nil!=new IntPtr(-1));
      handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handles,0,nil); Marshal.WriteIntPtr(handles,IntPtr.Size,outWrite); Marshal.WriteIntPtr(handles,IntPtr.Size*2,errWrite);
      Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
      var startup=new STARTUPINFOEX(); startup.startup.cb=Marshal.SizeOf(startup); startup.attributes=attrs; startup.startup.flags=0x100; startup.startup.stdin=nil; startup.startup.stdout=outWrite; startup.startup.stderr=errWrite;
      var variables=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase) { {"SystemRoot",Environment.GetEnvironmentVariable("SystemRoot")},{"LOCALAPPDATA",Environment.GetEnvironmentVariable("LOCALAPPDATA")},{"TEMP",work},{"TMP",work},{"PATH",runtime} };
      if(input.ContainsKey("electronNode") && (bool)input["electronNode"]) variables["ELECTRON_RUN_AS_NODE"]="1";
      env=Marshal.StringToHGlobalUni(String.Join("\0",variables.Select(kv=>kv.Key+"="+kv.Value))+"\0\0");
      // Stdio is exclusively inherited pipes/NUL. A windowless console still
      // needs a console host, which conflicts with the single-process policy.
      // DETACHED_PROCESS avoids allocating a console altogether.
      stage="create_process";
      Check(CreateProcess(exe,new StringBuilder(String.Join(" ",new[]{exe}.Concat(args).Select(Quote))),IntPtr.Zero,IntPtr.Zero,true,0x80000|0x400|0x4|0x8,env,work,ref startup,out process)); created=true;
      stage="assign_job";
      Check(AssignProcessToJobObject(job,process.process)); Check(ResumeThread(process.thread)!=0xffffffff);
      CloseHandle(outWrite); outWrite=IntPtr.Zero; CloseHandle(errWrite); errWrite=IntPtr.Zero;
      var budget=new OutputBudget(); budget.max=outputLimit;
      var stdout=Capture(outRead,budget); outRead=IntPtr.Zero; var stderr=Capture(errRead,budget); errRead=IntPtr.Zero;
      // EOF also means the parent disappeared: destroy the job, never orphan code.
      var cancellation=Task.Run(()=>Console.ReadLine()); var clock=System.Diagnostics.Stopwatch.StartNew();
      string status="completed", exceeded=null;
      for(;;) {
        stage="monitor";
        exceeded=ResourceEvent(port);
        if(exceeded!=null) { status="resource_limited"; TerminateJobObject(job,1); break; }
        if(budget.exceeded!=0) { status="resource_limited"; exceeded="output"; TerminateJobObject(job,1); break; }
        stage="workspace";
        long used=0; int count=0;
        if(WorkspaceExceeded(work,ref used,ref count,disk,fileLimit,0)) { status="resource_limited"; exceeded="workspace"; TerminateJobObject(job,1); break; }
        if(WaitForSingleObject(process.process,10)!=0x102) break;
        if(cancellation.IsCompleted) { status="cancelled"; TerminateJobObject(job,1); break; }
        if(clock.ElapsedMilliseconds>=timeout) { status="timed_out"; TerminateJobObject(job,1); break; }
      }
      WaitForSingleObject(process.process,5000); uint exit; Check(GetExitCodeProcess(process.process,out exit));
      stage="capture";
      string capturedOut=stdout.GetAwaiter().GetResult(), capturedErr=stderr.GetAwaiter().GetResult();
      if(status=="completed") {
        stage="monitor";
        exceeded=ResourceEvent(port); if(budget.exceeded!=0) exceeded="output";
        stage="workspace";
        long used=0; int count=0; if(WorkspaceExceeded(work,ref used,ref count,disk,fileLimit,0)) exceeded="workspace";
        if(exceeded!=null) status="resource_limited";
      }
      var result=new Dictionary<string,object> { {"status",status},{"stdoutBase64",capturedOut},{"stderrBase64",capturedErr},{"exitCode",(int)exit} };
      if(exceeded!=null) result["limit"]=exceeded; return result;
    } finally {
      if(created) TerminateProcess(process.process,1);
      foreach(var handle in new[]{job,port,process.thread,process.process,outRead,outWrite,errRead,errWrite,nil}) if(handle!=IntPtr.Zero && handle!=new IntPtr(-1)) CloseHandle(handle);
      if(attrs!=IntPtr.Zero) { DeleteProcThreadAttributeList(attrs); Marshal.FreeHGlobal(attrs); }
      foreach(var pointer in new[]{capPtr,policy,env,handles}) if(pointer!=IntPtr.Zero) Marshal.FreeHGlobal(pointer);
      if(sid!=IntPtr.Zero) FreeSid(sid);
      if(profileCreated) DeleteAppContainerProfile(profile);
    }
  }
  static int Main() {
    Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
    var json=new JavaScriptSerializer(); json.MaxJsonLength=6000000; // bounded output is base64-encoded
    try { var line=Console.ReadLine(); if(line==null || line.Length>2000000) throw new Exception("sandbox_input_limit"); Console.WriteLine(json.Serialize(Run(json.Deserialize<Dictionary<string,object>>(line)))); return 0; }
    catch(Exception error) { Console.WriteLine(json.Serialize(new {status="unavailable",stdoutBase64="",stderrBase64="",stage=stage,error=System.Text.RegularExpressions.Regex.IsMatch(error.Message,"^(win32_[0-9]+_at_[0-9]+|appcontainer_-?[0-9]+)$") ? error.Message : "hresult_"+unchecked((uint)error.HResult).ToString("X8"),exitCode=(int?)null})); return 1; }
  }
}
