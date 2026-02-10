# Tenseuron Governance

**How decisions are made in the reference network.**

Tenseuron does not use votes or DAOs. This document explains why and how governance actually works.

---

## Core Principles

### 1. Code = Policy

Changes to the reference network happen through code, not votes.

**Why**:
- Code is precise; votes are ambiguous
- Code can be tested; votes cannot
- Code is executable; votes are aspirational

**How it works**:
- Propose changes via pull requests
- Discuss trade-offs in code review
- Merge when consensus emerges among maintainers

---

### 2. Forks = Governance

Deep disagreements result in forks, not endless debate.

**Why**:
- Forks are real governance, not theater
- Multiple variants can coexist
- Best ideas win through adoption, not votes

**How it works**:
- Disagree with a policy? Fork the repo
- Implement your alternative
- Let the community choose through usage

---

### 3. Reputation = Influence

Contributors earn influence through demonstrated competence.

**Why**:
- Meritocracy over democracy
- Quality over quantity
- Expertise matters

**How it works**:
- Contribute high-quality code
- Run economic experiments
- Simulate attacks
- Improve policies
- Earn trust through results

---

## What's Centralized (By Design)

The reference network has opinions:

**Default Policies**:
- Risk thresholds
- Economic parameters
- Security assumptions
- Lifecycle rules

**Why centralize these?**

Decentralization is in **execution and participation**, not in pretending there are no defaults.

**Every system has defaults**. Tenseuron is honest about them.

---

## What's Decentralized

**Execution**:
- Anyone can run a node
- Anyone can be a miner, validator, or creator
- No central authority controls operations

**Participation**:
- Anyone can contribute code
- Anyone can fork the network
- Anyone can propose improvements

**Adoption**:
- Users choose which fork to use
- Market decides which policies work
- No central authority mandates choices

---

## How Changes Happen

### Minor Changes (Parameters)

**Examples**:
- Adjust graduation threshold
- Tweak risk decay rate
- Modify fee percentages

**Process**:
1. Open GitHub issue with rationale
2. Submit pull request with changes
3. Discuss trade-offs
4. Merge if consensus among maintainers

**Timeline**: Days to weeks

---

### Major Changes (Architecture)

**Examples**:
- New reputation model
- Different economic system
- Alternative security approach

**Process**:
1. Write design document
2. Implement in fork
3. Test and gather data
4. Propose merge or maintain as variant

**Timeline**: Weeks to months

---

### Fundamental Disagreements (Philosophy)

**Examples**:
- Reject adversarial-first design
- Prefer neutrality over opinions
- Want minimal protocol only

**Process**:
1. Fork the repository
2. Implement your vision
3. Document your philosophy
4. Build your community

**Timeline**: Permanent fork

---

## Contribution Types

### Welcomed Contributions

✅ **Bug fixes**
- Clear improvements with no trade-offs

✅ **Performance optimizations**
- Faster, cheaper, better

✅ **New adapters**
- Support for new databases, blockchains, storage

✅ **Economic experiments**
- Data-driven policy improvements

✅ **Attack simulations**
- Demonstrate vulnerabilities

✅ **Policy improvements**
- Better equilibriums with clear rationale

✅ **Documentation**
- Clarity, examples, guides

---

### Rejected Contributions

❌ **Feature requests without rationale**
- "Add this because I want it"

❌ **Simplification for simplification's sake**
- "This is too complex" without understanding why it exists

❌ **Removal of "complexity"**
- Without demonstrating it's unnecessary

❌ **Votes or polls**
- "Let's vote on this parameter"

❌ **Consensus theater**
- Endless discussion without code

---

## Maintainer Responsibilities

### Core Maintainers

**Responsibilities**:
- Review pull requests
- Maintain code quality
- Ensure coherence with philosophy
- Resolve conflicts
- Protect against scope creep

**Authority**:
- Merge or reject PRs
- Set development priorities
- Define release schedule

**Accountability**:
- Explain decisions
- Document rationale
- Respond to community

---

### Specialized Maintainers

**Economics**:
- Review economic policy changes
- Run simulations
- Analyze incentive structures

**Security**:
- Review security-related changes
- Conduct attack simulations
- Assess vulnerability reports

**Infrastructure**:
- Manage adapters
- Ensure runtime compatibility
- Optimize performance

---

## Decision-Making Process

### Consensus Among Maintainers

**Not**: Unanimous agreement
**Is**: Rough consensus

**Process**:
1. Proposal submitted
2. Maintainers review
3. Discussion of trade-offs
4. Decision made by lead maintainer if no consensus
5. Dissenters can fork

---

### Handling Disagreements

**Minor disagreements**:
- Discuss in PR comments
- Compromise if possible
- Lead maintainer decides if stuck

**Major disagreements**:
- Write competing proposals
- Implement both in branches
- Test and compare
- Choose based on data

**Fundamental disagreements**:
- Fork the repository
- Both variants can coexist
- Community chooses through usage

---

## Why No Voting?

### Problems with Voting

**Sybil attacks**:
- Easy to create fake identities
- Votes can be bought

**Tyranny of the majority**:
- 51% can override expert opinion
- Popularity ≠ correctness

**Bikeshedding**:
- Endless debate on trivial matters
- Important decisions delayed

**Theater**:
- Appearance of democracy without substance
- Votes often ignored anyway

---

### Why Code is Better

**Precision**:
- Code is unambiguous
- Votes are vague

**Testability**:
- Code can be tested
- Votes cannot

**Forkability**:
- Code can be forked
- Votes create winners and losers

**Meritocracy**:
- Code quality speaks for itself
- Votes reward popularity

---

## Why No DAO?

### Problems with DAOs

**Plutocracy**:
- Wealth = votes
- Rich control decisions

**Low participation**:
- Most token holders don't vote
- Decisions made by small minority

**Slow**:
- Proposal → Vote → Execution takes weeks
- Agility suffers

**Theater**:
- Appearance of decentralization
- Reality: whales decide

---

### Why Forks are Better

**Real decentralization**:
- Anyone can fork
- No permission needed

**Fast**:
- Fork immediately
- No waiting for votes

**Meritocratic**:
- Best fork wins through adoption
- Not through token holdings

**Honest**:
- No pretense of democracy
- Clear about who decides what

---

## Conflict Resolution

### Technical Conflicts

**Process**:
1. Identify the disagreement
2. Write competing implementations
3. Test both
4. Choose based on data

**Example**:
- Disagreement on risk decay function
- Implement exponential and linear
- Run simulations
- Choose based on results

---

### Philosophical Conflicts

**Process**:
1. Acknowledge fundamental disagreement
2. Document both philosophies
3. Fork if necessary
4. Let community choose

**Example**:
- Disagreement on adversarial-first design
- One fork: full security
- Another fork: minimal overhead
- Both can coexist

---

## Roadmap and Priorities

### Who Decides?

**Core maintainers** set priorities based on:
- Community feedback
- Technical debt
- Security concerns
- Economic experiments
- Adoption metrics

**Not based on**:
- Votes
- Token holdings
- Loudest voices

---

### How to Influence Priorities

**Contribute code**:
- Implement features yourself
- Pull requests speak louder than requests

**Run experiments**:
- Test alternative policies
- Share data and findings

**Find vulnerabilities**:
- Demonstrate attacks
- Propose fixes

**Improve documentation**:
- Make it easier for others to contribute

**Build on top**:
- Create applications using Tenseuron
- Show what's possible

---

## For Contributors

### How to Get Involved

1. **Read the docs**:
   - Understand the philosophy
   - Study the architecture
   - Review default policies

2. **Start small**:
   - Fix bugs
   - Improve documentation
   - Add tests

3. **Build expertise**:
   - Understand the trade-offs
   - Run experiments
   - Contribute insights

4. **Earn influence**:
   - Through quality contributions
   - Not through lobbying

---

### How to Propose Changes

1. **Open an issue**:
   - Describe the problem
   - Explain your proposed solution
   - Discuss trade-offs

2. **Write code**:
   - Implement your proposal
   - Add tests
   - Update documentation

3. **Submit PR**:
   - Clear description
   - Rationale for changes
   - Test results

4. **Engage in review**:
   - Respond to feedback
   - Iterate on design
   - Be open to alternatives

---

## For Forkers

### When to Fork

**You should fork if**:
- You disagree with core philosophy
- You need different trade-offs
- You want to experiment radically
- You have a different use case

**You should NOT fork if**:
- You just want a parameter changed
- You haven't tried contributing first
- You're not willing to maintain it

---

### How to Fork Successfully

1. **Document your philosophy**:
   - Why are you forking?
   - What's different?
   - What trade-offs did you make?

2. **Maintain quality**:
   - Keep tests passing
   - Update documentation
   - Fix bugs

3. **Build community**:
   - Explain your vision
   - Help users migrate
   - Collaborate with other forks

4. **Share learnings**:
   - What worked?
   - What didn't?
   - What did you discover?

---

## Governance Evolution

This governance model may evolve, but changes will be:

**Gradual**:
- No sudden shifts
- Plenty of notice

**Documented**:
- Clear rationale
- Public discussion

**Tested**:
- Experiment in forks first
- Adopt if successful

**Honest**:
- No pretense
- Clear about power structures

---

## Questions

**Q: Who really controls Tenseuron?**
**A**: Core maintainers control the reference implementation. Anyone can fork.

**Q: How do I get a feature added?**
**A**: Implement it and submit a PR. Or fork and add it yourself.

**Q: What if maintainers are wrong?**
**A**: Fork and prove them wrong through adoption.

**Q: Isn't this centralized?**
**A**: The reference implementation has maintainers. Execution and participation are decentralized. Forks are permissionless.

**Q: Why not let token holders vote?**
**A**: Plutocracy isn't decentralization. Forks are real governance.

**Q: How do I influence decisions?**
**A**: Contribute code, run experiments, find vulnerabilities, build applications.

**Q: What if I disagree fundamentally?**
**A**: Fork. That's the point.

---

**Tenseuron governance is honest, not theatrical.**

**Code over votes. Forks over consensus. Meritocracy over democracy.**

**If you have a better way, fork and prove it.**
