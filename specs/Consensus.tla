---- MODULE Consensus ----
(*
 * TLA+ Specification for Validator Consensus
 * 
 * This specification defines the consensus mechanism for validator agreement
 * in the Tenseuron Protocol. It ensures that N-of-M consensus is required
 * for task evaluation and settlement.
 * 
 * This is a lightweight formal specification - it documents intended behavior
 * but is not formally verified. Use as living documentation.
 *)

EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS
    (* Consensus configuration *)
    MinValidators,        (* Minimum validators required *)
    ConsensusThreshold,   (* Consensus threshold (0-1) *)
    MaxValidators         (* Maximum validators allowed *)

VARIABLES
    (* Validator state *)
    validators,           (* Set of validators *)
    validatorEvaluations,(* Map: validator -> evaluation *)
    consensusReached,     (* Boolean: whether consensus reached *)
    consensusOutput,      (* Output ID that reached consensus *)
    validatorCount        (* Number of validators who evaluated *)

TypeInvariant ==
    /\ validators \in SUBSET Validator
    /\ validatorEvaluations \in [validators -> Evaluation]
    /\ consensusReached \in BOOLEAN
    /\ consensusOutput \in OutputId \cup {NULL}
    /\ validatorCount \in 0..MaxValidators
    /\ Cardinality(validators) >= MinValidators
    /\ Cardinality(validators) <= MaxValidators

Init ==
    /\ validators = {}
    /\ validatorEvaluations = [v \in {} |-> NULL]
    /\ consensusReached = FALSE
    /\ consensusOutput = NULL
    /\ validatorCount = 0

(* Validator submits evaluation *)
SubmitEvaluation(validator, evaluation) ==
    /\ validator \in Validator
    /\ evaluation \in Evaluation
    /\ validatorCount < MaxValidators
    /\ validatorCount' = validatorCount + 1
    /\ validators' = validators \cup {validator}
    /\ validatorEvaluations' = [validatorEvaluations EXCEPT ![validator] = evaluation]
    /\ consensusReached' = CheckConsensus(validatorEvaluations', validatorCount')
    /\ consensusOutput' = IF consensusReached' 
                          THEN GetConsensusOutput(validatorEvaluations')
                          ELSE NULL

(* Check if consensus is reached *)
CheckConsensus(evaluations, count) ==
    LET
        (* Count evaluations per output *)
        outputCounts == [output \in OutputId |-> 
            Cardinality({v \in DOMAIN evaluations : evaluations[v].outputId = output})]
        (* Find output with highest count *)
        maxCount == CHOOSE c \in {outputCounts[o] : o \in OutputId} : 
            \A o \in OutputId : outputCounts[o] <= c
        (* Check if max count meets threshold *)
        thresholdCount == count * ConsensusThreshold
    IN
        maxCount >= thresholdCount

(* Get consensus output *)
GetConsensusOutput(evaluations) ==
    LET
        outputCounts == [output \in OutputId |-> 
            Cardinality({v \in DOMAIN evaluations : evaluations[v].outputId = output})]
        maxCount == CHOOSE c \in {outputCounts[o] : o \in OutputId} : 
            \A o \in OutputId : outputCounts[o] <= c
        consensusOutputs == {o \in OutputId : outputCounts[o] = maxCount}
    IN
        CHOOSE o \in consensusOutputs : TRUE

Next ==
    \E validator \in Validator :
    \E evaluation \in Evaluation :
        SubmitEvaluation(validator, evaluation)

(* INVARIANT: Minimum validators required *)
MinValidatorsInvariant ==
    Cardinality(validators) >= MinValidators \/ validatorCount = 0

(* INVARIANT: Consensus implies sufficient agreement *)
ConsensusThresholdInvariant ==
    consensusReached => 
        \E output \in OutputId :
            Cardinality({v \in validators : validatorEvaluations[v].outputId = output}) 
            >= validatorCount * ConsensusThreshold

(* INVARIANT: No consensus without validators *)
NoConsensusWithoutValidators ==
    validatorCount = 0 => ~consensusReached

(* INVARIANT: Consensus output is valid *)
ConsensusOutputValid ==
    consensusReached => consensusOutput \in OutputId

(* Main specification *)
Spec ==
    Init /\ [][Next]_<<validators, validatorEvaluations, consensusReached, consensusOutput, validatorCount>>

(* Properties to verify *)
MinValidatorsAlways ==
    Spec => []MinValidatorsInvariant

ConsensusThresholdAlways ==
    Spec => []ConsensusThresholdInvariant

NoConsensusWithoutValidatorsAlways ==
    Spec => []NoConsensusWithoutValidators

ConsensusOutputValidAlways ==
    Spec => []ConsensusOutputValid

(* Theorem: Minimum validators always required *)
THEOREM Spec => []MinValidatorsInvariant

(* Theorem: Consensus always meets threshold *)
THEOREM Spec => []ConsensusThresholdInvariant

(* Theorem: No consensus without validators *)
THEOREM Spec => []NoConsensusWithoutValidators

(* Theorem: Consensus output is always valid *)
THEOREM Spec => []ConsensusOutputValid

====
