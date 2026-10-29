#define _GNU_SOURCE
#include <errno.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
int main(void) {
  struct { const char *name; unsigned long flags; } cases[] = {
    {"ordinary_fork", 0}, {"pid_namespace", CLONE_NEWPID},
    {"network_namespace", CLONE_NEWNET}, {"user_namespace", CLONE_NEWUSER}
  };
  for (unsigned i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) {
    errno = 0;
    long child = syscall(SYS_clone, cases[i].flags | SIGCHLD, 0, 0, 0, 0);
    int error = errno;
    if (child == 0) _exit(0);
    if (child > 0) waitpid(child, NULL, 0);
    printf("%s: %s errno=%d\n", cases[i].name, child > 0 ? "passed" : "failed", error);
  }
  return 0;
}
