// Trusted supervisor. fd 3 is a host-only result pipe, closed before untrusted exec.
// RSS and total workspace quotas are monitored, not instantaneous kernel ceilings.
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <dirent.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#ifdef __APPLE__
#include <libproc.h>
#else
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <linux/audit.h>
#include <sched.h>
#include <stddef.h>
#endif
static volatile sig_atomic_t cancelled = 0;
static void cancel(int s) { (void)s; cancelled = 1; }
static void setup_failure(int fd) { ssize_t written; do { written=write(fd,"E",1); } while(written<0 && errno==EINTR); _exit(125); }
static uint64_t now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000; }
static int set_limit(int kind, rlim_t value) { struct rlimit r = { value, value }; return setrlimit(kind, &r); }
static int workspace(int fd, uint64_t *bytes, uint64_t *files, uint64_t max_bytes, uint64_t max_files, int depth) {
  if (depth > 32) return -1;
  DIR *dir = fdopendir(dup(fd)); if (!dir) return -1;
  rewinddir(dir);
  struct dirent *entry; int exceeded = 0;
  while ((entry = readdir(dir))) {
    if (!strcmp(entry->d_name,".") || !strcmp(entry->d_name,"..")) continue;
    struct stat st; if (fstatat(fd, entry->d_name, &st, AT_SYMLINK_NOFOLLOW)) { if (errno == ENOENT) continue; exceeded = -1; break; }
    (*files)++; if (S_ISREG(st.st_mode)) *bytes += st.st_size;
    if (*bytes > max_bytes || *files > max_files) { exceeded = 1; break; }
    if (S_ISDIR(st.st_mode)) { int child = openat(fd, entry->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW); if (child < 0) { if (errno == ENOENT) continue; exceeded = -1; break; } exceeded = workspace(child, bytes, files, max_bytes, max_files, depth+1); close(child); if (exceeded) break; }
  }
  closedir(dir); return exceeded;
}
static uint64_t resident(pid_t child) {
#ifdef __APPLE__
  struct proc_taskinfo info; if (proc_pidinfo(child, PROC_PIDTASKINFO, 0, &info, sizeof(info)) != sizeof(info)) return 0; return info.pti_resident_size;
#else
  char file[80]; snprintf(file,sizeof(file),"/proc/%d/statm",child); FILE *f=fopen(file,"r"); if(!f) return 0; unsigned long pages=0, rss=0; int ok=fscanf(f,"%lu %lu",&pages,&rss); fclose(f); return ok==2 ? rss*(uint64_t)sysconf(_SC_PAGESIZE) : 0;
#endif
}
#ifndef __APPLE__
// Threads are needed by Node/Python runtimes; child processes are not. clone3
// cannot safely inspect its pointer argument with classic BPF: force libc fallback.
static int restrict_processes(void) {
#if defined(__x86_64__)
  const unsigned int arch=AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
  const unsigned int arch=AUDIT_ARCH_AARCH64;
#else
  return -1;
#endif
  struct sock_filter rules[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,arch,1,0), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_socket,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_connect,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_kill,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_tkill,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_ptrace,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_process_vm_readv,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_process_vm_writev,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#ifdef __NR_pidfd_send_signal
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_pidfd_send_signal,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#endif
#ifdef __NR_pidfd_getfd
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_pidfd_getfd,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#endif
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_tgkill,0,4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,(unsigned int)getpid(),0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_prlimit64,0,5),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,(unsigned int)getpid(),0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#ifdef __NR_fork
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_fork,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#endif
#ifdef __NR_vfork
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_vfork,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
#endif
#ifdef __NR_clone3
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_clone3,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|ENOSYS),
#endif
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_clone,0,3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,CLONE_THREAD,1,0), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { (unsigned short)(sizeof(rules)/sizeof(rules[0])), rules };
  return prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0) || prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program);
}
#endif
int main(int argc, char **argv) {
  if (argc < 8) return 125;
  uint64_t timeout=strtoull(argv[1],NULL,10), memory=strtoull(argv[2],NULL,10), cpu=strtoull(argv[3],NULL,10), disk=strtoull(argv[4],NULL,10), files=strtoull(argv[5],NULL,10);
  if (!timeout || timeout>300000 || memory<67108864 || memory>1073741824 || !cpu || cpu>120 || !disk || disk>67108864 || !files || files>1024) return 125;
  int work=open(argv[6],O_RDONLY|O_DIRECTORY|O_NOFOLLOW); if(work<0) return 125;
  int error_pipe[2]; if(pipe(error_pipe)) return 125;
  fcntl(error_pipe[1],F_SETFD,FD_CLOEXEC);
#ifndef __APPLE__
  // A child must not read the supervisor's control FD or memory through /proc.
  if(prctl(PR_SET_DUMPABLE,0)) return 125;
#endif
  pid_t parent=getppid(); pid_t child=fork(); if(child<0) return 125;
  if(!child) {
    close(error_pipe[0]); close(work); close(3);
    struct rlimit cpu_limit={cpu,cpu+1};
    if(set_limit(RLIMIT_CORE,0) || setrlimit(RLIMIT_CPU,&cpu_limit) || set_limit(RLIMIT_FSIZE,disk) || set_limit(RLIMIT_NOFILE,128)) setup_failure(error_pipe[1]);
#ifndef __APPLE__
    if(prctl(PR_SET_PDEATHSIG,SIGKILL) || restrict_processes()) setup_failure(error_pipe[1]);
#endif
    execv(argv[7],&argv[7]); setup_failure(error_pipe[1]);
  }
  close(error_pipe[1]); signal(SIGTERM,cancel); signal(SIGINT,cancel); signal(SIGHUP,cancel);
  char setup_error=0; ssize_t setup_read; do { setup_read=read(error_pipe[0],&setup_error,1); } while(setup_read<0 && errno==EINTR); if(setup_read<0) setup_error='E'; close(error_pipe[0]);
  uint64_t start=now_ms(); int status=0,reaped=0; struct rusage usage; memset(&usage,0,sizeof(usage)); const char *state="completed", *limit=NULL;
  for(;;) {
    pid_t ended=wait4(child,&status,WNOHANG,&usage); if(ended==child) { reaped=1; break; }
    if(ended<0 && errno!=EINTR) { state="unavailable"; break; }
    if(setup_error) { state="unavailable"; break; }
    if(cancelled || getppid()!=parent) { state="cancelled"; break; }
    if(now_ms()-start>=timeout) { state="timed_out"; break; }
    if(resident(child)>memory) { state="resource_limited"; limit="memory"; break; }
    uint64_t used=0,count=0; int quota=workspace(work,&used,&count,disk,files,0);
    if(quota) { state=quota>0?"resource_limited":"unavailable"; if(quota>0) limit="workspace"; break; }
    struct timespec delay={0,10000000}; nanosleep(&delay,NULL);
  }
  if(!reaped) { kill(child,SIGKILL); while(wait4(child,&status,0,&usage)<0 && errno==EINTR) {} }
  if(setup_error) state="unavailable";
  if(WIFSIGNALED(status) && !strcmp(state,"completed")) {
    int sig=WTERMSIG(status); if(sig==SIGXCPU || (sig==SIGKILL && (uint64_t)(usage.ru_utime.tv_sec+usage.ru_stime.tv_sec)>=cpu)) { state="resource_limited"; limit="cpu"; }
    if(sig==SIGXFSZ) { state="resource_limited"; limit="workspace"; }
  }
  // Check short-lived writers too: the final scan is necessary between polls.
  uint64_t used=0,count=0; if(!strcmp(state,"completed") && workspace(work,&used,&count,disk,files,0)>0) { state="resource_limited"; limit="workspace"; }
  close(work);
  dprintf(3,"{\"status\":\"%s\",\"exitCode\":%d%s%s%s}\n",state,WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status),limit?",\"limit\":\"":"",limit?limit:"",limit?"\"":"");
  return 0;
}
